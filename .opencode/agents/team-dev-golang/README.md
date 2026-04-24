# TBS Golang Team

Tim AI agent untuk pengembangan microservice Golang production-grade.

## Hierarki

```
jon.md  (PM)
  └── lead/
  │     ├── kai.md   (Tech Lead · Principal)    ← otoritas teknis tertinggi
  │     ├── zara.md  (Backend Lead · Principal) ← propose ADR backend, Kai approve
  │     └── nova.md  (Frontend Lead · Principal)← propose ADR frontend, Kai approve
  ├── engineers/
  │     ├── backend/
  │     │     └── milo.md  (Senior Backend Eng Go)
  │     └── frontend/
  │           └── leo.md   (Senior Frontend Eng)
  └── qa/
        ├── kira.md  (Senior QA Automation)
        └── dani.md  (Senior QA Feature · release sign-off)
```

## Alur Kerja

```
Jon → Kai → Zara (BE arch + proto) ──► Milo (implementasi Go)
          └── Nova (FE arch)        ──► Leo  (implementasi React)
          ├── Kira (automated test, paralel)
          └── Dani (manual test, sign-off → Jon release)

ATURAN: Proto contract selesai & Kai approve → Milo dan Leo bisa paralel
```

## Stack

Go 1.22+ · gRPC · Protobuf (Buf) · Kafka · NATS JetStream · PostgreSQL · Redis · Next.js 14+ · TypeScript · TanStack Query · Kubernetes · GitHub Actions

## Kapan Panggil Siapa

| Situasi | Agent |
|---------|-------|
| Fitur baru, belum ada PRD | Jon |
| Sprint plan, feasibility, inter-service decision | Kai |
| Proto design, ADR backend, Go architecture | Zara |
| Implementasi gRPC, Kafka, repository Go | Milo |
| ADR frontend, design system, microfrontend | Nova |
| Implementasi React, Next.js, API integration | Leo |
| Go test, contract test Pact, CI pipeline, k6 | Kira |
| Test plan, exploratory, bug report, release sign-off | Dani |
