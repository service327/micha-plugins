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
  { name: 'PC Micha Büro unten', match: /micha unten|büro unten/i },
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
  // desktop-i4gdm3o: noch unklar (HG Büro oder Micha Büro unten) – dort gilt die Auswahl „Dieser Rechner“
  'desktop-vfa6sdr': 'PC Werkstatt',
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
    const m = line.match(/^\s*(.+?)\s*\[([0-9a-z]{4,})\](.*)$/i)
    if (!m || /^This session/i.test(line)) continue
    const title = m[1].trim()
    const status = (m[3].match(/(idle|offline|working|busy|running|online|active)\s*$/i) ?? [])[1]?.toLowerCase() ?? 'unbekannt'
    peers.push({ title, id: m[2], status, machine: machineOf(title, m[2], assign) })
  }
  if (peers.length === 0 && text.trim()) throw new Error('Rechner-Liste aus der Cloud konnte nicht gelesen werden')
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

async function toggleRemote($: Eng) {
  const d = await read($, data)
  const wantOn = d.remote !== 'on'
  await update($, data, x => ({ ...x, remote: 'connecting' }))
  try {
    const text = await callTool($, 'set_remote_control', { session_id: 'self', enabled: wantOn })
    const state = (text.match(/\b(on|off|connecting|unavailable)\b/) ?? [])[1]
    await update($, data, x => ({ ...x, remote: state ?? (wantOn ? 'on' : 'off') }))
    $.ui.toast(wantOn ? 'Remote Control ist AN' : 'Remote Control ist AUS')
    if (wantOn) void maybeTagTitle($)
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
  await $.store.set('hidden', true)
  await update($, data, d => ({ ...d, hidden: true }))
  await $.ui.close({ id: PANE }).catch(() => undefined)
  $.ui.toast('Cockpit ausgeblendet. Wieder einblenden: /cockpit ins Eingabefeld tippen.')
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

// ---------- Anzeige ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'cockpit', description: 'Micha-Cockpit öffnen (Projekte, Rechner, Remote Control)' })
    const thisMachine = await detectMachine($)
    const hidden = (await $.store.get('hidden')) === true
    await update($, data, d => ({ ...d, thisMachine, hidden }))
    void refresh($, false).catch(() => undefined)
    void maybeTagTitle($)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void maybeTagTitle($)
    return done
  })

  on('command.run', { command: 'cockpit' }, async $ => {
    await $.store.set('hidden', false)
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
    const byMachine = new Map<string, Peer[]>()
    for (const m of MACHINES) byMachine.set(m.name, [])
    for (const p of d.peers) byMachine.set(p.machine, [...(byMachine.get(p.machine) ?? []), p])
    const isOnline = (ps: Peer[]) => ps.some(p => p.status !== 'offline')
    const rank = (n: string) => (n === 'Nicht zugeordnet' ? 2 : n === d.thisMachine || isOnline(byMachine.get(n) ?? []) ? 0 : 1)
    const names = [...byMachine.keys()]
      .filter(n => n !== 'Nicht zugeordnet' || (byMachine.get(n) ?? []).length > 0)
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    const el = $.ui.resolve(e) as unknown as Record<string, unknown>
    const pick = 'Select' in el ? (el as unknown as { Select: ElementConstructor<SelectProps> }) : null
    const local = d.sessions.filter(s => !s.archived).slice(0, 12)
    const peerRow = (x: Peer) => (
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" gap={1}>
          <Text color={x.status !== 'offline' ? '#2E7D32' : '#6B7280'}>{x.status !== 'offline' ? '●' : '○'}</Text>
          <Text wrap="wrap">{x.title}</Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={2}>
        <Text dimColor>{x.status === 'idle' ? 'online, wartet' : x.status === 'offline' ? 'aus' : x.status}</Text>
        {pick && (
          <pick.Select
            key={`as-${x.id}`}
            label="Rechner"
            value={d.assign[tkey(x.title)] ?? d.assign[x.id] ?? ''}
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
                    {online ? 'online' : 'offline'}
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
                {isOpen && !here && (
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
