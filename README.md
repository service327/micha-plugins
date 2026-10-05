# Michas Claude-Code-Plugins

Eigene Plugins für Claude Code von Michael Schmitz.

## micha-cockpit
Leiste über dem Eingabefeld mit **📁 Projekte**, **💻 Rechner** und **📡 Remote**-Schalter:
- Projekte: alle „gebaut“-Ordner, neueste Session per „▶ Weiter“
- Rechner: welche Rechner/Sessions gerade online sind (über die Claude-Cloud)
- Remote Control per Knopf ein/aus
- Ausblenden mit ✕, wieder einblenden mit `/cockpit`
- Rechner-Kürzel: Sessions mit eingeschaltetem Remote Control bekommen automatisch das Kürzel ihres Rechners vorne in den Titel (z. B. „[HG] …“, „[Werkstatt] …“). Daran erkennen alle Cockpits, auf welchem Rechner eine Session läuft.

## Erlaubnisse (in ~/.claude/settings.json → permissions.allow)
`mcp__ccd_session_mgmt__list_sessions`, `mcp__ccd_session_mgmt__get_session`, `mcp__ccd_session_mgmt__set_remote_control`, `ListAgents`, `mcp__ccd_session_mgmt__set_session_title`

## Installieren (auf jedem Rechner einmal)
```
claude plugin marketplace add service327/micha-plugins
claude plugin install micha-cockpit@micha-plugins
```

## Aktualisieren
```
claude plugin marketplace update micha-plugins
claude plugin update micha-cockpit@micha-plugins
```
