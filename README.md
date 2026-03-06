# Tropobank

Tropobank e un motore di ricerca per domande teoria ATPL con:

- autenticazione (registrazione/login/logout)
- sessione singola per account (niente login simultanei)
- licenza a tempo (14 giorni, estendibile)
- pagamento Stripe Checkout (test mode) con supporto TWINT opzionale
- pannello admin utenti (lista, estensione/revoca licenza, revoca sessione)
- menu separato con pagine `/app` (home), `/search` (database), `/settings` (utente)
- pannello admin separato su `/admin`

## Requisiti

- Node.js 18+
- npm

## Setup locale

```bash
cp .env.example .env
npm install
npm start
```

Apri `http://localhost:3000`.

## Variabili ambiente

Definisci almeno:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `APP_BASE_URL`

Facoltative:

- `PORT` (default 3000, il server prova automaticamente porte successive se occupata)
- `LICENSE_DAYS` (default 14)
- `LICENSE_PRICE_CENTS` (default 2900)
- `LICENSE_CURRENCY` (default eur)
- `ENABLE_TWINT` (`true` per provare ad attivare TWINT in Checkout)
- `COOKIE_SECURE` (`true` in produzione HTTPS)
- `ADMIN_EMAIL` (default `donati@gionata.ch`)
- `ADMIN_NAME` (default `Gionata Donati`)
- `ADMIN_BOOTSTRAP_PASSWORD` (password bootstrap se l'admin non esiste ancora)

## Stripe webhook

In test mode, punta il webhook a:

`POST /api/billing/webhook`

Evento richiesto:

- `checkout.session.completed`

Quando il pagamento e `paid`, la licenza dell'utente viene estesa di `LICENSE_DAYS`.

## Deploy rapido su server Linux

```bash
git clone https://github.com/Protsky/horizon.git
cd horizon
cp .env.example .env
# inserisci le tue chiavi reali test mode
npm install
npm start
```

Per produzione persistente usa un process manager (es. PM2 o systemd) e un reverse proxy HTTPS (Nginx/Caddy).
