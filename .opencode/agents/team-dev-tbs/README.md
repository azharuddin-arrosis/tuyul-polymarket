# TBS Laravel Team

Tim AI agent untuk pengembangan Laravel production — startup kelas atas.

## Hierarki

```
jon.md  (PM)
  └── lead/
  │     ├── rex.md    (Tech Lead)          ← jembatan PM ↔ engineer
  │     └── morgan.md (Principal Architect) ← propose ADR, Rex approve
  ├── engineers/
  │     ├── riley.md  (Senior Backend Eng)
  │     └── sam.md    (Senior Integration Eng)
  └── qa/
        ├── kira.md   (Senior QA Automation)
        └── dani.md   (Senior QA Feature · release sign-off)
```

## Alur Kerja

```
Jon → Rex → Morgan (arsitektur)
         ├── Riley (core logic)
         ├── Sam (integrasi)
         ├── Kira (automated test, paralel dengan dev)
         └── Dani (manual test, sign-off → Jon release)
```

## Stack

Laravel 10/11/12 · PHP 8.2+ · Pest/PHPUnit · Laravel Reverb · Redis · PostgreSQL/MySQL · Docker · GitHub Actions

## Kapan Panggil Siapa

| Situasi | Agent |
|---------|-------|
| Fitur baru, belum ada PRD | Jon |
| Feasibility, sprint plan, task breakdown | Rex |
| Keputusan arsitektur, ADR, realtime, SEO, infra | Morgan |
| Business logic, Eloquent, API, migration | Riley |
| Payment, webhook, queue, notifikasi, integrasi | Sam |
| Automated test, Pest, CI pipeline, Dusk, k6 | Kira |
| Test plan, manual test, bug report, release sign-off | Dani |
