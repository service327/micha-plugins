# Michas Claude-Code-Plugins

Eigene Plugins für Claude Code von Michael Schmitz.

## micha-cockpit
Leiste über dem Eingabefeld mit **📁 Projekte**, **💻 Rechner** und **📡 Remote**-Schalter:
- Projekte: alle „gebaut“-Ordner, neueste Session per „▶ Weiter“
- Rechner: welche Rechner/Sessions gerade online sind (über die Claude-Cloud)
- Remote Control per Knopf ein/aus
- Ausblenden mit ✕, wieder einblenden mit `/cockpit`

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
