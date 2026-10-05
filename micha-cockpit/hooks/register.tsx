import { atom, read, update } from 'claude-code'
import type { ElementConstructor, EngineInterface, Register, SelectProps } from 'claude-code'

import type { Data, Detail, Page, Peer, Program, Session, View } from '../types'

// Micha-Cockpit: Leiste über dem Eingabefeld (Projekte, Rechner, Remote Control)
// und eine Seitenleiste zum Durchklicken.

const PANE = 'cockpit'
const TITLE = 'Micha-Cockpit'

const VIEW0: View = {
  page: 'projekte',
  path: null,
  showOld: false,
  showArchived: false,
  showAllPrograms: false,
  openMachine: null,
  showOffline: false,
}
const DATA0: Data = {
  sessions: [],
  programs: [],
  roots: [],
  peers: [],
  remote: 'unbekannt',
  loadedAt: 0,
  peersAt: 0,
  error: null,
  busy: false,
  detail: null,
  assign: {},
  thisMachine: '',
  hidden: false,
  version: '',
  latest: '',
  updateState: '',
  autoRemote: true,
  missingPerms: [],
}
const view = atom({ plugin: 'micha-cockpit', key: 'view' } as const, VIEW0)
const data = atom({ plugin: 'micha-cockpit', key: 'data' } as const, DATA0)

// Rechner und woran man sie im Session-Namen erkennt (vorläufig, bis es Anker-Sessions gibt)
const MACHINES: { name: string; match: RegExp }[] = [
  { name: 'PC Windows Computerzimmer', match: /computer ?zimmer|desktop-b8rp1n5/i },
  { name: 'iMac Computerzimmer', match: /\bimac\b/i },
  { name: 'MacbookPro2019', match: /macbook|\bmac\b/i },
  { name: 'PC Büro Oben Alt', match: /oben alt/i },
  { name: 'PC Büro Oben Neu', match: /oben neu|win11_oben|neue[rn]? büro/i },
  { name: 'PC HG Büro', match: /\bhg\b/i },
  { name: 'PC Micha Büro unten', match: /micha unten|büro unten|desktop-i4gdm3o/i },
  { name: 'PC Werkstatt', match: /werkstatt|desktop-vfa6sdr/i },
  { name: 'PC Theke', match: /theke/i },
  { name: 'Laptop Alt', match: /laptop alt|laptop 1\b/i },
  { name: 'Laptop Neu', match: /laptop neu/i },
]
// Kürzel, das vorne in den Session-Titel kommt – daran erkennen alle Rechner, wo eine Session läuft
const TAGS: Record<string, string> = {
  'PC Windows Computerzimmer': 'Computerzimmer',
  'iMac Computerzimmer': 'iMac',
  MacbookPro2019: 'MacBook',
  'PC Büro Oben Alt': 'Oben Alt',
  'PC Büro Oben Neu': 'Oben Neu',
  'PC HG Büro': 'HG',
  'PC Micha Büro unten': 'Micha unten',
  'PC Werkstatt': 'Werkstatt',
  'PC Theke': 'Theke',
  'Laptop Alt': 'Laptop Alt',
  'Laptop Neu': 'Laptop Neu',
}
const machineOfTag = (title: string) => {
  const m = title.match(/^\s*\[([^\]]+)\]/)
  if (!m) return undefined
  const tag = m[1].trim().toLowerCase()
  return Object.keys(TAGS).find(k => TAGS[k].toLowerCase() === tag)
}

// Rechnername (hostname) → Name im Cockpit; sonst wählt Micha ihn einmal auf der Rechner-Seite aus
const HOSTS: Record<string, string> = {
  'desktop-b8rp1n5': 'PC Windows Computerzimmer',
  'desktop-i4gdm3o': 'PC Micha Büro unten', // von Micha am 05.10.2026 vor Ort bestätigt
  'desktop-vfa6sdr': 'PC Werkstatt',
  'win11_oben': 'PC Büro Oben Neu', // von Micha am 05.10.2026 bestätigt
  'desktop-4puo7vo': 'PC Büro Oben Alt', // von Micha am 05.10.2026 bestätigt
}
async function detectMachine($: Eng): Promise<string> {
  const saved = (await $.store.get('thisMachine')) as string | undefined
  if (saved) return saved
  try {
    const host = (await $.process.run(['hostname'])).stdout.trim().toLowerCase()
    const short = host.split('.')[0]
    if (HOSTS[short]) return HOSTS[short]
    if (/imac/.test(short)) return 'iMac Computerzimmer'
    if (/macbook/.test(short)) return 'MacbookPro2019'
  } catch {
    /* unbekannt */
  }
  return ''
}

type Eng = EngineInterface

// ---------- kleine Helfer ----------

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const isInside = (child: string, parent: string) => {
  const c = norm(child)
  const p = norm(parent)
  return c === p || c.startsWith(p + '/')
}
const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p

async function home($: Eng): Promise<string> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '/'
}
const sepOf = (h: string) => (h.includes('\\') ? '\\' : '/')
const join = (sep: string, ...parts: string[]) =>
  parts.map((x, i) => (i === 0 ? x.replace(/[\\/]+$/, '') : x.replace(/^[\\/]+|[\\/]+$/g, ''))).join(sep)

function ago(now: number, ms: number): string {
  if (!ms) return '–'
  const min = Math.round((now - ms) / 60000)
  if (min < 2) return 'gerade eben'
  if (min < 60) return `vor ${min} Min.`
  const h = Math.round(min / 60)
  if (h < 24) return `vor ${h} Std.`
  const d = Math.round(h / 24)
  if (d < 2) return 'gestern'
  if (d < 14) return `vor ${d} Tagen`
  const t = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(t.getUTCDate())}.${p(t.getUTCMonth() + 1)}.${t.getUTCFullYear()}`
}

// ---------- Werkzeuge der App aufrufen ----------

let toolNames: string[] | null = null
async function toolName($: Eng, suffix: string): Promise<string | null> {
  if (!toolNames) toolNames = (await $.tool.list()).map(t => t.name)
  return toolNames.find(n => n === suffix || n.endsWith('__' + suffix)) ?? null
}
async function callTool($: Eng, suffix: string, args: Record<string, unknown>): Promise<string> {
  const name = await toolName($, suffix)
  if (!name) throw new Error(`Werkzeug „${suffix}“ ist in dieser Session nicht verfügbar`)
  const r = await $.tool.call({ tool: name, ...args } as never)
  if (r.deny !== undefined) {
    if (/classifier|auto mode|permission|denied/i.test(r.deny))
      throw new Error('Von der Sicherheitsprüfung blockiert – Erlaubnis fehlt noch (siehe Anleitung im Chat)')
    throw new Error(r.deny)
  }
  return r.text ?? ''
}

async function loadSessions($: Eng): Promise<Session[]> {
  const parse = (x: Record<string, unknown>): Session => ({
    id: String(x.sessionId ?? ''),
    title: String(x.title ?? '(ohne Titel)'),
    cwd: String(x.cwd ?? ''),
    archived: x.isArchived === true,
    running: x.isRunning === true,
    last: Date.parse(String(x.lastActivityAt ?? '')) || 0,
    link: String(x.link ?? ''),
    remote: x.remoteControlActive === true,
    isSelf: false,
  })
  const list = JSON.parse(await callTool($, 'list_sessions', { limit: 500, include_archived: true }))
  const out: Session[] = Array.isArray(list) ? list.map(parse) : []
  try {
    const self = JSON.parse(await callTool($, 'get_session', { session_id: 'self' }))
    out.push({ ...parse(self), running: true, isSelf: true, last: await $.clock.now(), remote: self.remoteControlState === 'on' || self.remoteControlActive === true })
  } catch {
    /* ohne die eigene Session weiter */
  }
  return out.sort((a, b) => b.last - a.last)
}

async function loadRemote($: Eng): Promise<string> {
  const self = JSON.parse(await callTool($, 'get_session', { session_id: 'self' }))
  return String(self.remoteControlState ?? (self.remoteControlActive ? 'on' : 'off'))
}

// Feste Zuordnung Session → Rechner (von Micha ausgewählt), dauerhaft gespeichert
// Zuordnung über den Session-Titel: der ist auf allen Rechnern gleich (die Kurz-IDs nicht)
const SEED: Record<string, string> = {
  'title:downloads-ordner inventar als pdf': 'MacbookPro2019',
  'title:externe festplatte erkennen sichern': 'PC Windows Computerzimmer',
  'title:bitte remote control einschalten': 'PC Werkstatt',
  'title:remote session aktivieren': 'PC Micha Büro unten', // vorläufig
}
const tkey = (title: string) => 'title:' + title.trim().toLowerCase()
async function loadAssign($: Eng): Promise<Record<string, string>> {
  const saved = (await $.store.get('assign')) as Record<string, string> | undefined
  return { ...SEED, ...(saved ?? {}) }
}
async function saveAssign($: Eng, title: string, machine: string) {
  const id = tkey(title)
  const all = await loadAssign($)
  if (machine === '-') delete all[id]
  else all[id] = machine
  await $.store.set('assign', all)
  await update($, data, d => ({
    ...d,
    assign: all,
    peers: d.peers.map(p => (tkey(p.title) === id ? { ...p, machine: machineOf(p.title, p.id, all) } : p)),
  }))
}
const machineOf = (title: string, id: string, assign: Record<string, string>) =>
  machineOfTag(title) ?? assign[tkey(title)] ?? assign[id] ?? MACHINES.find(x => x.match.test(title))?.name ?? 'Nicht zugeordnet'

async function loadPeers($: Eng, assign: Record<string, string>): Promise<Peer[]> {
  const text = await callTool($, 'ListAgents', {})
  const peers: Peer[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/ /g, ' ')
    // Kennung = letzte eckige Klammer mit Hex-Ref (der Titel selbst kann „[Kürzel]“ enthalten)
    const m = line.match(/^\s*(.+?)\s*\[([0-9a-f]{6,})\](.*)$/i) ?? line.match(/^\s*(.+?)\s*\[([0-9a-z]{4,})\](.*)$/i)
    if (!m || /^This session/i.test(line)) continue
    const title = m[1].trim()
    const status = (m[3].match(/(idle|offline|working|busy|running|online|active|requires_action)\s*$/i) ?? [])[1]?.toLowerCase() ?? 'unbekannt'
    peers.push({ title, id: m[2], status, machine: machineOf(title, m[2], assign) })
  }
  // Nur ein Fehler, wenn Zeilen mit Kennung da waren, aber keine gelesen werden konnte – sonst gibt es einfach keine anderen Sessions
  if (peers.length === 0 && /\[[0-9a-f]{6,}\]/i.test(text.replace(/^.*This session.*$/im, '')))
    throw new Error(`Rechner-Liste konnte nicht gelesen werden: „${text.trim().split(/\r?\n/).slice(0, 3).join(' | ').slice(0, 160)}“`)
  return peers
}

async function scanPrograms($: Eng): Promise<{ roots: string[]; programs: Program[] }> {
  const h = await home($)
  const sep = sepOf(h)
  const bases = [h, join(sep, h, 'Desktop'), join(sep, h, 'Documents')]
  // Windows: auch direkt auf dem Laufwerk suchen (z. B. C:\Micha\Programme Micha gebaut, C:\ClaudeCode)
  if (sep === '\\') {
    const drive = (await $.env.get('SystemDrive')) ?? 'C:'
    bases.push(drive + '\\')
  }
  const roots: string[] = []
  const dirs = async (p: string) => {
    try {
      return (await $.fs.list(p)).filter(e => e.kind === 'dir' && !e.name.startsWith('.'))
    } catch {
      return []
    }
  }
  for (const b of bases) {
    for (const e of await dirs(b)) {
      const p = join(sep, b, e.name)
      if (/gebaut|^claude ?code$/i.test(e.name)) roots.push(p)
      else if (/^micha$/i.test(e.name)) {
        for (const f of await dirs(p)) if (/gebaut|bau_|progs|programm/i.test(f.name)) roots.push(join(sep, p, f.name))
      }
    }
  }
  const unique = [...new Map(roots.map(r => [norm(r), r])).values()]
  const programs: Program[] = []
  for (const r of unique) {
    for (const e of await dirs(r)) {
      const path = join(sep, r, e.name)
      let mtime = 0
      try {
        mtime = (await $.fs.stat(path)).mtimeMs ?? 0
      } catch {
        /* egal */
      }
      programs.push({ name: e.name, path, root: r, mtime })
    }
  }
  return { roots: unique, programs }
}

async function loadDetail($: Eng, path: string): Promise<Detail> {
  const entries = await $.fs.list(path).catch(() => [])
  const vis = entries.filter(e => !e.name.startsWith('.'))
  const dirs = vis.filter(e => e.kind === 'dir').map(e => e.name).sort((a, b) => a.localeCompare(b))
  const files = vis.filter(e => e.kind === 'file').map(e => e.name).sort((a, b) => a.localeCompare(b))
  const readmeName = files.find(f => /^readme(\.md|\.txt)?$/i.test(f))
  let readme: string | null = null
  if (readmeName) {
    const sep = path.includes('\\') ? '\\' : '/'
    readme = await $.fs
      .read(join(sep, path, readmeName))
      .then(t => (typeof t === 'string' ? t.split('\n').slice(0, 14).join('\n') : null))
      .catch(() => null)
  }
  return { path, dirs, files, readme }
}

// ---------- Aktionen ----------

async function refresh($: Eng, withPeers: boolean) {
  await update($, data, d => ({ ...d, busy: true, error: null }))
  const errors: string[] = []
  const [sessions, remote, scan] = await Promise.all([
    loadSessions($).catch(e => (errors.push(String(e?.message ?? e)), null)),
    loadRemote($).catch(e => (errors.push(String(e?.message ?? e)), null)),
    scanPrograms($).catch(e => (errors.push(String(e?.message ?? e)), null)),
  ])
  const assign = await loadAssign($).catch(() => ({ ...SEED }))
  const peers = withPeers ? await loadPeers($, assign).catch(e => (errors.push(String(e?.message ?? e)), null)) : null
  const now = await $.clock.now()
  await update($, data, d => ({
    ...d,
    sessions: sessions ?? d.sessions,
    remote: remote ?? d.remote,
    roots: scan?.roots ?? d.roots,
    programs: scan?.programs ?? d.programs,
    peers: peers ?? d.peers,
    assign,
    peersAt: peers ? now : d.peersAt,
    loadedAt: now,
    busy: false,
    error: errors.length ? [...new Set(errors)].join(' · ') : null,
  }))
}

async function openPage($: Eng, page: Page, path: string | null = null) {
  await update($, view, v => ({ ...v, page, path, showOld: false }))
  await $.ui.open({ id: PANE, title: TITLE })
  if (page === 'programm' && path) {
    const detail = await loadDetail($, path)
    await update($, data, d => ({ ...d, detail }))
  }
  const d = await read($, data)
  const now = await $.clock.now()
  const stale = now - d.loadedAt > 60_000
  const peersStale = page === 'rechner' && now - d.peersAt > 60_000
  if (stale || peersStale) void refresh($, page === 'rechner')
}

// ---------- Erlaubnisse, die das Cockpit braucht (permissions.allow in ~/.claude/settings.json) ----------

const NEEDED_PERMS = [
  'mcp__ccd_session_mgmt__list_sessions',
  'mcp__ccd_session_mgmt__get_session',
  'mcp__ccd_session_mgmt__set_remote_control',
  'mcp__ccd_session_mgmt__set_session_title',
  'ListAgents',
]

async function settingsPath($: Eng): Promise<string> {
  const h = await home($)
  const sep = sepOf(h)
  return join(sep, h, '.claude', 'settings.json')
}

async function checkPermissions($: Eng) {
  let missing: string[] = []
  try {
    const cfg = JSON.parse(await $.fs.read(await settingsPath($)))
    const allow: unknown = cfg?.permissions?.allow
    const have = new Set(Array.isArray(allow) ? allow.map(String) : [])
    missing = NEEDED_PERMS.filter(p => !have.has(p))
  } catch {
    missing = [...NEEDED_PERMS] // Datei fehlt oder ist nicht lesbar
  }
  await update($, data, d => ({ ...d, missingPerms: missing }))
}

// Nur auf Knopfdruck: ergänzt ausschließlich die fehlenden Einträge aus NEEDED_PERMS, ändert sonst nichts
async function addPermissions($: Eng) {
  const path = await settingsPath($)
  let cfg: Record<string, unknown> = {}
  try {
    cfg = JSON.parse(await $.fs.read(path))
  } catch (e) {
    const exists = await $.fs.stat(path).then(() => true).catch(() => false)
    if (exists) {
      $.ui.toast('settings.json ist nicht lesbar – bitte nicht automatisch ändern. Claude in einer Session um Hilfe bitten.')
      return
    }
  }
  const perms = (cfg.permissions && typeof cfg.permissions === 'object' ? cfg.permissions : {}) as Record<string, unknown>
  const allow = Array.isArray(perms.allow) ? perms.allow.map(String) : []
  const added = NEEDED_PERMS.filter(p => !allow.includes(p))
  if (added.length === 0) {
    await checkPermissions($)
    $.ui.toast('Alle Erlaubnisse sind schon eingetragen.')
    return
  }
  cfg.permissions = { ...perms, allow: [...allow, ...added] }
  try {
    await $.fs.write(path, JSON.stringify(cfg, null, 2) + '\n')
    await checkPermissions($)
    $.ui.toast(`${added.length} Erlaubnis(se) für das Cockpit eingetragen. Falls etwas noch nicht geht: App einmal neu starten.`)
    // jetzt erlaubt: Remote/Kürzel nochmal versuchen
    autoRemoteDone = false
    tagged = false
    void maybeAutoRemote($).then(() => maybeTagTitle($))
  } catch (e) {
    $.ui.toast(`Eintragen ging nicht: ${String((e as Error)?.message ?? e)}`)
  }
}

// Steht Remote auf „verbinde …“, alle 3 s nachfragen, bis die Verbindung steht (höchstens ~30 s)
function settleRemote($: Eng, tries = 10) {
  $.clock.after(3000, () => {
    void (async () => {
      let st = 'connecting'
      try {
        st = await loadRemote($)
        await update($, data, x => ({ ...x, remote: st }))
      } catch {
        /* nächster Versuch */
      }
      if (st === 'connecting' && tries > 1) settleRemote($, tries - 1)
      else if (st === 'on') void maybeTagTitle($)
    })()
  })
}

// Remote Control beim Start automatisch einschalten (Einstellung gilt für alle Sessions, Standard: an)
let autoRemoteDone = false
async function maybeAutoRemote($: Eng) {
  if (autoRemoteDone) return
  if ((await $.store.get('autoRemote')) === false) {
    autoRemoteDone = true
    return
  }
  try {
    const self = JSON.parse(await callTool($, 'get_session', { session_id: 'self' }))
    const st = String(self.remoteControlState ?? (self.remoteControlActive ? 'on' : 'off'))
    if (st === 'on' || st === 'connecting' || st === 'unavailable' || self.startedViaRemoteControl === true) {
      autoRemoteDone = true
      if (st === 'on') await update($, data, x => ({ ...x, remote: 'on' }))
      return
    }
    const text = await callTool($, 'set_remote_control', { session_id: 'self', enabled: true })
    const state = (text.match(/\b(on|off|connecting|unavailable)\b/) ?? [])[1] ?? 'on'
    autoRemoteDone = true
    await update($, data, x => ({ ...x, remote: state }))
    if (state === 'on' || state === 'connecting') void maybeTagTitle($)
    if (state === 'connecting') settleRemote($)
  } catch {
    /* direkt beim Start evtl. noch nicht möglich – nach der nächsten Antwort nochmal */
  }
}

async function setAutoRemote($: Eng, on: boolean) {
  await $.store.set('autoRemote', on)
  await update($, data, x => ({ ...x, autoRemote: on }))
  $.ui.toast(on ? 'Neue Sessions schalten Remote Control ab jetzt automatisch ein.' : 'Remote Control wird beim Start nicht mehr automatisch eingeschaltet.')
}

async function toggleRemote($: Eng) {
  autoRemoteDone = true // von Hand geschaltet → nicht mehr automatisch eingreifen
  const d = await read($, data)
  const wantOn = d.remote !== 'on'
  await update($, data, x => ({ ...x, remote: 'connecting' }))
  try {
    const text = await callTool($, 'set_remote_control', { session_id: 'self', enabled: wantOn })
    const state = (text.match(/\b(on|off|connecting|unavailable)\b/) ?? [])[1]
    await update($, data, x => ({ ...x, remote: state ?? (wantOn ? 'on' : 'off') }))
    $.ui.toast(wantOn ? 'Remote Control ist AN' : 'Remote Control ist AUS')
    if (wantOn) void maybeTagTitle($)
    if (state === 'connecting') settleRemote($)
  } catch (e) {
    await update($, data, x => ({ ...x, remote: d.remote }))
    $.ui.toast(`Remote Control: ${String((e as Error)?.message ?? e)}`)
  }
}

async function toggleRemoteFor($: Eng, s: Session) {
  const wantOn = !s.remote
  try {
    const self = s.isSelf
    const text = await callTool($, 'set_remote_control', { session_id: self ? 'self' : s.id, enabled: wantOn })
    const on = /\bon\b|connecting/.test(text) && wantOn
    await update($, data, d => ({
      ...d,
      sessions: d.sessions.map(x => (x.id === s.id ? { ...x, remote: on } : x)),
      remote: self ? (on ? 'on' : 'off') : d.remote,
    }))
    $.ui.toast(`${s.title}: Remote Control ${on ? 'AN' : 'AUS'}`)
  } catch (e) {
    $.ui.toast(`Remote Control: ${String((e as Error)?.message ?? e)}`)
  }
}

let tagged = false
async function maybeTagTitle($: Eng) {
  if (tagged) return
  const d = await read($, data)
  const tag = TAGS[d.thisMachine]
  if (!tag) return
  try {
    const self = JSON.parse(await callTool($, 'get_session', { session_id: 'self' }))
    const title = String(self.title ?? '').trim()
    const remoteOn = self.remoteControlState === 'on' || self.remoteControlActive === true
    if (!remoteOn || !title || /^(new session|neue session|untitled)$/i.test(title)) return
    const m = title.match(/^\s*\[([^\]]+)\]\s*/)
    if (m) {
      const old = m[1].trim()
      // fremdes/eigenes Kürzel stehen lassen; nur ein bekanntes, aber falsches Rechner-Kürzel austauschen
      const known = Object.values(TAGS).some(t => t.toLowerCase() === old.toLowerCase())
      if (!known || old.toLowerCase() === tag.toLowerCase()) {
        tagged = true
        return
      }
      await callTool($, 'set_session_title', { session_id: 'self', title: `[${tag}] ${title.slice(m[0].length)}` })
      tagged = true
      return
    }
    await callTool($, 'set_session_title', { session_id: 'self', title: `[${tag}] ${title}` })
    tagged = true
  } catch {
    /* später nochmal versuchen */
  }
}

async function hideBar($: Eng) {
  // nur für diese Session ausblenden – neue Sessions zeigen das Cockpit immer
  await update($, data, d => ({ ...d, hidden: true }))
  await $.ui.close({ id: PANE }).catch(() => undefined)
  $.ui.toast('Cockpit in dieser Session ausgeblendet. Wieder einblenden: /cockpit ins Eingabefeld tippen.')
}

async function setThisMachine($: Eng, name: string) {
  await $.store.set('thisMachine', name)
  await update($, data, d => ({ ...d, thisMachine: name }))
  // Rechner gewechselt → Kürzel im eigenen Session-Titel neu setzen bzw. austauschen
  tagged = false
  void maybeTagTitle($)
}

async function openSession($: Eng, s: Session) {
  if (!s.link) {
    $.ui.toast('Für diese Session gibt es keinen Öffnen-Link.')
    return
  }
  const isWin = sepOf(await home($)) === '\\'
  const argv = isWin ? ['cmd', '/c', 'start', '', s.link] : ['open', s.link]
  try {
    await $.process.run(argv)
  } catch (e) {
    $.ui.toast(`Öffnen ging nicht: ${String((e as Error)?.message ?? e)}`)
  }
}

async function newSessionHere($: Eng, path: string, surface: Parameters<Eng['ui']['copy']>[0]['surface']) {
  await $.ui.copy({ text: path, surface })
  $.ui.toast('Ordnerpfad kopiert. Oben links „Neue Session“ → Ordner wählen → Pfad einfügen.')
}

// ---------- Selbst-Update von GitHub ----------

const LATEST_URL = 'https://raw.githubusercontent.com/service327/micha-plugins/main/micha-cockpit/.claude-plugin/plugin.json'
const LATEST_API = 'https://api.github.com/repos/service327/micha-plugins/contents/micha-cockpit/.claude-plugin/plugin.json?ref=main'

// true, wenn Version a neuer ist als b (Format 1.2.3)
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

async function checkVersions($: Eng) {
  await update($, data, d => ({ ...d, updateState: d.updateState === 'neustart' ? 'neustart' : 'pruefe' }))
  let version = ''
  let latest = ''
  try {
    const root = $.plugin.root
    const sep = sepOf(root)
    version = String(JSON.parse(await $.fs.read(join(sep, root, '.claude-plugin', 'plugin.json'))).version ?? '')
  } catch {
    /* unbekannt */
  }
  // Erst die GitHub-Schnittstelle (sofort aktuell), sonst raw.githubusercontent (bis zu 5 Min. zwischengespeichert)
  for (const [url, headers] of [
    [LATEST_API, { accept: 'application/vnd.github.raw', 'user-agent': 'micha-cockpit' }],
    [`${LATEST_URL}?t=${await $.clock.now()}`, {}],
  ] as const) {
    try {
      const r = await $.http.fetch(url, { headers })
      if (r.ok) {
        latest = String(JSON.parse(r.text).version ?? '')
        if (latest) break
      }
    } catch {
      /* nächste Quelle versuchen */
    }
  }
  await update($, data, d => ({ ...d, version, latest, updateState: d.updateState === 'neustart' ? 'neustart' : latest ? '' : 'offline' }))
}

// Wo liegt das claude-Programm? Bevorzugt das der Desktop-App (neueste Version), sonst „claude“ aus dem PATH.
async function claudeExes($: Eng): Promise<string[]> {
  const out: string[] = []
  const h = await home($)
  const isWin = sepOf(h) === '\\'
  const appData = isWin ? ((await $.env.get('APPDATA')) ?? join('\\', h, 'AppData', 'Roaming')) : join('/', h, 'Library', 'Application Support')
  const sep = sepOf(appData)
  const base = join(sep, appData, 'Claude', 'claude-code')
  const exeName = isWin ? 'claude.exe' : 'claude'
  try {
    const versions = (await $.fs.list(base)).filter(e => e.kind === 'dir').map(e => e.name)
    versions.sort((a, b) => (isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0))
    for (const v of versions) {
      // Mac: gezielt <Version>/<Kennung>/claude.app/Contents/MacOS/claude prüfen (liegt 4 Ebenen tief)
      if (!isWin) {
        try {
          for (const s of (await $.fs.list(join(sep, base, v))).filter(e => e.kind === 'dir')) {
            const p = join(sep, base, v, s.name, 'claude.app', 'Contents', 'MacOS', 'claude')
            if (await $.fs.stat(p).then(() => true).catch(() => false)) out.push(p)
          }
        } catch {
          /* weiter mit der allgemeinen Suche */
        }
        if (out.length) break
      }
      // allgemein: claude(.exe) im Versionsordner oder darunter (Windows bis 2, Mac bis 4 Ebenen)
      const maxDepth = isWin ? 2 : 4
      const queue: { path: string; depth: number }[] = [{ path: join(sep, base, v), depth: 0 }]
      while (queue.length) {
        const cur = queue.shift()!
        let entries: Awaited<ReturnType<Eng['fs']['list']>> = []
        try {
          entries = await $.fs.list(cur.path)
        } catch {
          continue
        }
        for (const e of entries) {
          const p = join(sep, cur.path, e.name)
          if (e.kind === 'file' && e.name.toLowerCase() === exeName) out.push(p)
          else if (e.kind === 'dir' && cur.depth < maxDepth) queue.push({ path: p, depth: cur.depth + 1 })
        }
      }
      if (out.length) break
    }
  } catch {
    /* keine Desktop-App-CLI gefunden */
  }
  out.push('claude')
  return out
}

async function runSelfUpdate($: Eng) {
  const d0 = await read($, data)
  if (d0.updateState === 'laeuft') return
  await update($, data, d => ({ ...d, updateState: 'laeuft' }))
  $.ui.toast('Cockpit wird von GitHub aktualisiert …')
  let ok = false
  for (const exe of await claudeExes($)) {
    try {
      const a = await $.process.run([exe, 'plugin', 'marketplace', 'update', 'micha-plugins'], { timeoutMs: 180000 })
      if (a.exitCode !== 0) continue
      const b = await $.process.run([exe, 'plugin', 'update', 'micha-cockpit@micha-plugins'], { timeoutMs: 180000 })
      if (b.exitCode === 0) {
        ok = true
        break
      }
    } catch {
      /* nächstes Programm versuchen */
    }
  }
  if (ok) {
    await update($, data, d => ({ ...d, updateState: 'neustart' }))
    $.ui.toast(`Cockpit ${d0.latest || ''} installiert. Bitte die Claude-App einmal ganz beenden und neu öffnen.`)
  } else {
    await update($, data, d => ({ ...d, updateState: 'fehler' }))
    $.ui.toast('Update ging nicht automatisch. Bitte in einer Session sagen: „Bitte micha-cockpit aktualisieren“.')
  }
}

// ---------- Anzeige ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'cockpit', description: 'Micha-Cockpit öffnen (Projekte, Rechner, Remote Control)' })
    const thisMachine = await detectMachine($)
    // Altlast bis 0.5.2: „ausgeblendet“ galt für alle Sessions – zurücksetzen
    if ((await $.store.get('hidden')) === true) await $.store.set('hidden', false)
    const autoRemote = (await $.store.get('autoRemote')) !== false
    await update($, data, d => ({ ...d, thisMachine, autoRemote }))
    await checkPermissions($).catch(() => undefined)
    void refresh($, false).catch(() => undefined)
    void maybeAutoRemote($)
    void maybeTagTitle($)
    void checkVersions($).catch(() => undefined)
    // alle 30 Minuten auf eine neue Cockpit-Version prüfen
    $.clock.every(30 * 60 * 1000, () => void checkVersions($).catch(() => undefined))
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void maybeAutoRemote($).then(() => maybeTagTitle($))
    return done
  })

  on('command.run', { command: 'cockpit' }, async $ => {
    await update($, data, d => ({ ...d, hidden: false }))
    await openPage($, 'projekte')
    return { text: 'Micha-Cockpit geöffnet.' }
  })

  // Die Leiste über dem Eingabefeld
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if ((await read($, data)).hidden) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const d = await read($, data)
    const r = d.remote
    const color = r === 'on' ? '#2E7D32' : r === 'connecting' ? '#B8860B' : '#6B7280'
    const label =
      r === 'on' ? '📡 Remote AN' : r === 'connecting' ? '📡 verbinde …' : r === 'unavailable' ? '📡 Remote n/v' : '📡 Remote AUS'
    // Versions-/Update-Knopf
    const hasUpdate = !!d.latest && !!d.version && isNewer(d.latest, d.version)
    const verLabel =
      d.updateState === 'laeuft'
        ? '⏳ Update läuft …'
        : d.updateState === 'neustart'
          ? '🔄 App neu starten'
          : d.updateState === 'pruefe'
            ? `v${d.version || '?'} · prüfe …`
            : hasUpdate
              ? `⬆ Update auf ${d.latest}`
              : d.updateState === 'fehler'
                ? `⚠ v${d.version} · nochmal`
                : d.updateState === 'offline'
                  ? `v${d.version || '?'} · GitHub?`
                  : `✓ v${d.version || '?'}`
    const onVer = () => {
      if (d.updateState === 'neustart') $.ui.toast('Bitte die Claude-App ganz beenden (auch unten rechts neben der Uhr) und neu öffnen.')
      else if (hasUpdate || d.updateState === 'fehler') void runSelfUpdate($)
      else void checkVersions($).then(async () => {
        const n = await read($, data)
        $.ui.toast(
          !n.latest
            ? 'GitHub ist gerade nicht erreichbar – bitte später nochmal klicken.'
            : isNewer(n.latest, n.version)
              ? `Neue Version ${n.latest} verfügbar – nochmal klicken zum Aktualisieren.`
              : `Cockpit ist aktuell (v${n.version}).`,
        )
      })
    }
    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text bold color="#E8B10C">
          Cockpit
        </Text>
        <Button key="mc-proj" label="📁 Projekte" onPress={() => void openPage($, 'projekte')} />
        <Button key="mc-rech" label="💻 Rechner" onPress={() => void openPage($, 'rechner')} />
        <Box backgroundColor={color} paddingX={1}>
          <Button key="mc-remote" plain label={label} onPress={() => void toggleRemote($)} />
        </Box>
        {d.missingPerms.length > 0 && (
          <Box backgroundColor="#B45309" paddingX={1}>
            <Button key="mc-perms" plain label={`🔑 Erlaubnisse einrichten (${d.missingPerms.length})`} onPress={() => void addPermissions($)} />
          </Box>
        )}
        {hasUpdate || d.updateState === 'neustart' ? (
          <Box backgroundColor="#1D4ED8" paddingX={1}>
            <Button key="mc-ver" plain label={verLabel} onPress={onVer} />
          </Box>
        ) : (
          <Button key="mc-ver" plain dimColor label={verLabel} onPress={onVer} />
        )}
        <Button key="mc-hide" plain dimColor label="✕" onPress={() => void hideBar($)} />
      </Box>
    )
  })

  // Die Seitenleiste
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const v = await read($, view)
    const d = await read($, data)
    const now = await $.clock.now()
    const surface = e.surface

    const tabs = (
      <Box flexDirection="row" gap={1}>
        <Button key="t-proj" label="📁 Projekte" variant={v.page !== 'rechner' ? 'primary' : undefined} onPress={() => void openPage($, 'projekte')} />
        <Button key="t-rech" label="💻 Rechner" variant={v.page === 'rechner' ? 'primary' : undefined} onPress={() => void openPage($, 'rechner')} />
        <Button key="t-ref" label={d.busy ? '⏳ lädt …' : '↻ Aktualisieren'} onPress={() => void refresh($, v.page === 'rechner')} />
      </Box>
    )
    const err = d.error ? <Text color="#C0392B">⚠ {d.error}</Text> : null

    const sessionsOf = (path: string) =>
      d.sessions.filter(s => s.cwd && isInside(s.cwd, path) && (v.showArchived || !s.archived))

    const sessionRow = (s: Session, highlight: boolean) => (
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" gap={1}>
          <Text color={s.running ? '#2E7D32' : undefined}>{s.running ? '●' : '○'}</Text>
          <Text bold={highlight} wrap="wrap">
            {s.title}
          </Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={2}>
        <Button key={`s-${s.id}`} label={highlight ? '▶ Weiter' : 'öffnen'} variant={highlight ? 'primary' : undefined} onPress={() => void openSession($, s)} />
        <Text dimColor>
          {ago(now, s.last)}
          {s.archived ? ' · archiviert' : ''}
          {s.remote ? ' · 📡' : ''}
        </Text>
        </Box>
      </Box>
    )

    // ----- Seite: Projekte -----
    if (v.page === 'projekte') {
      const rows = d.programs
        .map(p => {
          const ss = sessionsOf(p.path)
          return { p, ss, last: Math.max(p.mtime, ss[0]?.last ?? 0) }
        })
        .sort((a, b) => b.last - a.last)
      const shown = v.showAllPrograms ? rows : rows.slice(0, 15)
      const outside = d.sessions.filter(
        s => s.cwd && !d.roots.some(r => isInside(s.cwd, r)) && (v.showArchived || !s.archived),
      )
      const outsideDirs = [...new Set(outside.map(s => s.cwd))]
      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          {err}
          {d.roots.length === 0 && !d.busy && <Text dimColor>Kein „gebaut“-Ordner gefunden (gesucht in Benutzerordner, Desktop, Dokumente).</Text>}
          {d.roots.length > 0 && <Text dimColor>Ordner: {d.roots.map(baseName).join(', ')}</Text>}
          <Box flexDirection="column">
            {shown.map(({ p, ss, last }) => (
              <Box flexDirection="column" marginBottom={1}>
                <Button key={`p-${p.path}`} plain label={`📁 ${p.name}`} onPress={() => void openPage($, 'programm', p.path)} />
                <Box flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={2}>
                {ss[0] ? (
                  <Button key={`w-${p.path}`} label="▶ Weiter" variant="primary" onPress={() => void openSession($, ss[0])} />
                ) : (
                  <Button key={`n-${p.path}`} label="＋ Neu" onPress={() => void newSessionHere($, p.path, surface)} />
                )}
                <Text dimColor>
                  {ss.length ? `${ss.length} Session${ss.length > 1 ? 's' : ''} · ` : 'keine Session · '}
                  {ago(now, last)}
                </Text>
                </Box>
              </Box>
            ))}
          </Box>
          {rows.length > 15 && (
            <Button
              key="more-progs"
              label={v.showAllPrograms ? 'weniger anzeigen' : `alle ${rows.length} anzeigen`}
              onPress={() => void update($, view, x => ({ ...x, showAllPrograms: !x.showAllPrograms }))}
            />
          )}
          {outsideDirs.length > 0 && (
            <Box flexDirection="column">
              <Text bold>Sessions in anderen Ordnern</Text>
              {outsideDirs.slice(0, 8).map(dir => (
                <Box flexDirection="row" gap={1}>
                  <Button key={`o-${dir}`} plain label={`📂 ${baseName(dir)}`} onPress={() => void openPage($, 'programm', dir)} />
                  <Text dimColor>{outside.filter(s => s.cwd === dir).length} Session(s)</Text>
                </Box>
              ))}
            </Box>
          )}
          <Button
            key="arch"
            label={v.showArchived ? 'Archivierte ausblenden' : 'Archivierte auch zeigen'}
            onPress={() => void update($, view, x => ({ ...x, showArchived: !x.showArchived }))}
          />
        </Box>
      )
    }

    // ----- Seite: ein Programm / Ordner -----
    if (v.page === 'programm' && v.path) {
      const path = v.path
      const det = d.detail && norm(d.detail.path) === norm(path) ? d.detail : null
      const ss = sessionsOf(path)
      const prog = d.programs.find(p => isInside(path, p.path))
      const parent = prog && norm(prog.path) !== norm(path) ? path.replace(/[\\/][^\\/]+[\\/]?$/, '') : null
      const sep = path.includes('\\') ? '\\' : '/'
      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          {err}
          <Box flexDirection="row" gap={1}>
            <Button key="back" label="← Zurück" onPress={() => void (parent ? openPage($, 'programm', parent) : openPage($, 'projekte'))} />
            <Text bold>📁 {baseName(path)}</Text>
          </Box>
          <Text dimColor wrap="wrap">
            {path}
          </Text>
          <Box flexDirection="column">
            <Text bold>Sessions</Text>
            {ss.length === 0 && <Text dimColor>Noch keine Session zu diesem Ordner.</Text>}
            {ss[0] && sessionRow(ss[0], true)}
            {ss.length > 1 && (
              <Button
                key="old"
                plain
                label={v.showOld ? `▾ Ältere Sessions (${ss.length - 1})` : `▸ Ältere Sessions (${ss.length - 1})`}
                onPress={() => void update($, view, x => ({ ...x, showOld: !x.showOld }))}
              />
            )}
            {v.showOld && ss.slice(1).map(s => sessionRow(s, false))}
            <Button key="new-here" label="＋ Neue Session für diesen Ordner" onPress={() => void newSessionHere($, path, surface)} />
          </Box>
          {det && det.dirs.length > 0 && (
            <Box flexDirection="column">
              <Text bold>Unterordner</Text>
              {det.dirs.slice(0, 20).map(name => (
                <Button key={`d-${name}`} plain label={`📂 ${name}`} onPress={() => void openPage($, 'programm', join(sep, path, name))} />
              ))}
            </Box>
          )}
          {det && det.files.length > 0 && (
            <Box flexDirection="column">
              <Text bold>Dateien ({det.files.length})</Text>
              <Text dimColor wrap="wrap">
                {det.files.slice(0, 18).join(' · ')}
                {det.files.length > 18 ? ' …' : ''}
              </Text>
            </Box>
          )}
          {det?.readme && (
            <Box flexDirection="column">
              <Text bold>Beschreibung (README)</Text>
              <Text wrap="wrap">{det.readme}</Text>
            </Box>
          )}
        </Box>
      )
    }

    // ----- Seite: Rechner -----
    // Einsortieren: Kürzel/Zuordnung/Stichwort (p.machine); sonst eigene lokale Session → dieser Rechner;
    // sonst laufend → „Nicht zugeordnet“, ausgeschaltet → „Ältere Sessions (Herkunft unbekannt)“
    const UNASSIGNED = 'Nicht zugeordnet'
    const OLD = 'Ältere Sessions (Herkunft unbekannt)'
    const localTitles = new Set(d.sessions.map(s => tkey(s.title)))
    const effMachine = (p: Peer) =>
      p.machine !== UNASSIGNED
        ? p.machine
        : d.thisMachine && localTitles.has(tkey(p.title))
          ? d.thisMachine
          : p.status === 'offline'
            ? OLD
            : UNASSIGNED
    const byMachine = new Map<string, Peer[]>()
    for (const m of MACHINES) byMachine.set(m.name, [])
    for (const p of d.peers) {
      const m = effMachine(p)
      byMachine.set(m, [...(byMachine.get(m) ?? []), { ...p, machine: m }])
    }
    const isOnline = (ps: Peer[]) => ps.some(p => p.status !== 'offline')
    const rank = (n: string) =>
      n === OLD ? 3 : n === UNASSIGNED ? 2 : n === d.thisMachine || isOnline(byMachine.get(n) ?? []) ? 0 : 1
    const names = [...byMachine.keys()]
      .filter(n => (n !== UNASSIGNED && n !== OLD) || (byMachine.get(n) ?? []).length > 0)
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    const el = $.ui.resolve(e) as unknown as Record<string, unknown>
    const pick = 'Select' in el ? (el as unknown as { Select: ElementConstructor<SelectProps> }) : null
    const local = d.sessions.filter(s => !s.archived).slice(0, 12)
    const peerRow = (x: Peer, withPick = true) => (
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" gap={1}>
          <Text color={x.status !== 'offline' ? '#2E7D32' : '#6B7280'}>{x.status !== 'offline' ? '●' : '○'}</Text>
          <Text wrap="wrap">{x.title}</Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={2}>
        <Text dimColor>{x.status === 'idle' ? 'online, wartet' : x.status === 'offline' ? 'aus' : x.status}</Text>
        {pick && withPick && (
          <pick.Select
            key={`as-${x.id}`}
            label="Rechner"
            value={x.machine !== UNASSIGNED && x.machine !== OLD ? x.machine : ''}
            options={[...MACHINES.map(m => ({ value: m.name, label: m.name })), { value: '-', label: '(Zuordnung lösen)' }]}
            onSelect={val => void saveAssign($, x.title, val)}
          />
        )}
        </Box>
      </Box>
    )
    return (
      <Box flexDirection="column" gap={1}>
        {tabs}
        {err}
        <Text dimColor>
          {d.peersAt ? `Stand: ${ago(now, d.peersAt)}` : d.busy ? 'Lade Rechner aus der Claude-Cloud …' : 'Noch nicht geladen – ↻ Aktualisieren'} · Session falsch einsortiert? Rechner rechts daneben auswählen
        </Text>
        {pick && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Text dimColor>{d.thisMachine ? 'Dieser Rechner:' : 'Welcher Rechner ist das hier?'}</Text>
            <pick.Select
              key="this-machine"
              label="Dieser Rechner"
              value={d.thisMachine}
              options={MACHINES.map(m => ({ value: m.name, label: m.name }))}
              onSelect={val => void setThisMachine($, val)}
            />
          </Box>
        )}
        <Box flexDirection="row" columnGap={1}>
          <Button
            key="auto-remote"
            plain
            label={d.autoRemote ? '📡 Remote beim Start: automatisch AN' : '📡 Remote beim Start: aus'}
            onPress={() => void setAutoRemote($, !d.autoRemote)}
          />
        </Box>
        <Box flexDirection="column">
          {names.map(name => {
            const ps = byMachine.get(name) ?? []
            const here = name === d.thisMachine
            const online = here || isOnline(ps)
            const isOpen = v.openMachine === name
            return (
              <Box flexDirection="column">
                <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                  <Text color={online ? '#2E7D32' : '#6B7280'}>{online ? '●' : '○'}</Text>
                  <Button
                    key={`m-${name}`}
                    plain
                    label={`${isOpen ? '▾' : '▸'} ${name}`}
                    onPress={() => void update($, view, x => ({ ...x, openMachine: x.openMachine === name ? null : name }))}
                  />
                  <Text dimColor>
                    {here ? 'dieser Rechner · ' : ''}
                    {online ? 'online' : name === OLD ? 'ausgeschaltet' : 'offline'}
                    {ps.length ? ` · ${ps.length} Session${ps.length > 1 ? 's' : ''}` : ''}
                  </Text>
                </Box>
                {isOpen && here && (
                  <Box flexDirection="column" paddingLeft={3}>
                    <Text bold>Sessions auf diesem Rechner</Text>
                    {local.map(x => (
                      <Box flexDirection="column" marginBottom={1}>
                        <Text bold={x.running} wrap="wrap">{x.title}</Text>
                        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                          <Button key={`ls-${x.id}`} label="↪ wechseln" variant="primary" onPress={() => void openSession($, x)} />
                          <Box backgroundColor={x.remote ? '#2E7D32' : '#6B7280'} paddingX={1}>
                            <Button key={`lr-${x.id}`} plain label={x.remote ? '📡 AN' : '📡 AUS'} onPress={() => void toggleRemoteFor($, x)} />
                          </Box>
                          <Text dimColor>{x.running ? 'offen' : ago(now, x.last)}</Text>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )}
                {isOpen && name === OLD && (
                  <Box flexDirection="column" paddingLeft={3}>
                    <Text dimColor wrap="wrap">
                      Alte, ausgeschaltete Sessions ohne Rechner-Kürzel. Von welchem Rechner sie stammen, lässt sich nicht mehr feststellen – sie stören nicht. Neue Sessions bekommen ihr Kürzel automatisch.
                    </Text>
                    {ps.map(x => peerRow(x, false))}
                  </Box>
                )}
                {isOpen && !here && name !== OLD && (
                  <Box flexDirection="column" paddingLeft={3}>
                    {ps.filter(x => x.status !== 'offline').length === 0 && <Text dimColor>Keine Session mit eingeschaltetem Remote Control.</Text>}
                    {ps.filter(x => x.status !== 'offline').length > 0 && <Text bold>Eingeschaltet (online)</Text>}
                    {ps.filter(x => x.status !== 'offline').map(x => peerRow(x))}
                    {ps.some(x => x.status === 'offline') && (
                      <Button
                        key={`off-${name}`}
                        plain
                        label={`${v.showOffline ? '▾' : '▸'} Ausgeschaltet (${ps.filter(x => x.status === 'offline').length})`}
                        onPress={() => void update($, view, x => ({ ...x, showOffline: !x.showOffline }))}
                      />
                    )}
                    {v.showOffline && ps.filter(x => x.status === 'offline').map(x => peerRow(x))}
                    {ps.length > 0 && (
                      <Text dimColor wrap="wrap">
                        Wechseln in eine Session auf einem anderen Rechner: links in der App-Seitenleiste den Rechner auswählen, oder über claude.ai/code.
                      </Text>
                    )}
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })
}
