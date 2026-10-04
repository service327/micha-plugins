export type Session = {
  id: string
  title: string
  cwd: string
  archived: boolean
  running: boolean
  last: number
  link: string
  remote: boolean
  isSelf: boolean
}
export type Program = { name: string; path: string; root: string; mtime: number }
export type Peer = { title: string; id: string; status: string; machine: string }
export type Detail = { path: string; dirs: string[]; files: string[]; readme: string | null }
export type Page = 'projekte' | 'programm' | 'rechner'
export type View = {
  page: Page
  path: string | null
  showOld: boolean
  showArchived: boolean
  showAllPrograms: boolean
  openMachine: string | null
  showOffline: boolean
}
export type Data = {
  sessions: Session[]
  programs: Program[]
  roots: string[]
  peers: Peer[]
  remote: string
  loadedAt: number
  peersAt: number
  error: string | null
  busy: boolean
  detail: Detail | null
  assign: Record<string, string>
  thisMachine: string
  hidden: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'micha-cockpit': { view: View; data: Data }
  }
}
