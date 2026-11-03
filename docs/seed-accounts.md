# Trackfud local test accounts

Seeded automatically on every backend boot (idempotent — a reseed repairs
passwords, roles and rows). **Local development only**; all rows are
fictional. ID numbers in courier rows are placeholders (`317400000000000N`),
AES-GCM-sealed and never returned by the API.

Use the matching `X-TF-App` header when logging in:
`customer` / `courier` / `merchant` / `cms`.

## Canonical accounts — password `trackfud123`

| Role | Email | Password | Ready to use because |
| ---- | ----- | -------- | -------------------- |
| Courier | `runnerbiker@example.com` | `trackfud123` | `approved`, mode `runner` |
| Merchant | `merchant@example.com` | `trackfud123` | Owns approved store `Warung Test Rasa` + 3 items |
| Customer | `customer@example.com` | `trackfud123` | Wallet funded Rp 200.000 |
| CMS Admin | `admin@example.com` | `trackfud123` | `admin` role, Back Office review queues |

## Requested accounts — password `trackfud123`

| Role | Email | Password | Ready to use because |
| ---- | ----- | -------- | -------------------- |
| Courier | `runner@example.com` | `trackfud123` | Approved runner, full profile + passed fitness |
| Courier | `biker@example.com` | `trackfud123` | Approved biker (city bike), full profile + passed |
| Courier | `runner2@example.com` | `trackfud123` | Approved runner, full profile + passed fitness |
| Merchant | `chickenresto@example.com` | `trackfud123` | `Ayam Geprek Sambal Korek` + signed agreement + 5 items |
| Merchant | `noodleresto@example.com` | `trackfud123` | `Mie Ayam Bangka Asli` + signed agreement + 5 items |
| Customer | `customer2@example.com` | `trackfud123` | Wallet Rp 200.000 + Home/Office addresses (Jakarta) |

## GBK district (Gelora Bung Karno) — password `trackfud123`

Base: Stadion Utama GBK (-6.2186006, 106.8029661). See README
"GBK live district" for what each group exercises.

**Merchants** (approved, signed, menus, on-shift staff):

| Store | Email | Password |
| ----- | ----- | -------- |
| Sate Senayan GBK | `sate.gbk@example.com` | `trackfud123` |
| Bakmi Ayam GBK | `bakmi.gbk@example.com` | `trackfud123` |
| Nasi Padang Merdeka Senayan | `padang.gbk@example.com` | `trackfud123` |
| Kopi Senayan Park | `kopi.gbk@example.com` | `trackfud123` |
| Gado-Gado Sehat Madya | `gado.gbk@example.com` | `trackfud123` |
| Ayam Goreng Arena | `ayam.gbk@example.com` | `trackfud123` |

**Staff / kasir** (one per store, on shift + `can_deliver`, roster linked
exactly like an accepted invite). Log in on the courier app
(`X-TF-App: courier`) and enter staff mode: `GET /v1/courier/staff/memberships`
lists the store, and staff-fallback offers reach them when no runner or biker
takes an order (or with the demo **force no-courier** switch):

| Name | Email | Password | Staff at |
| ---- | ----- | -------- | -------- |
| Sari | `kasir.sategbk@example.com` | `trackfud123` | Sate Senayan GBK |
| Budi | `kasir.bakmigbk@example.com` | `trackfud123` | Bakmi Ayam GBK |
| Rahmat | `kasir.padanggbk@example.com` | `trackfud123` | Nasi Padang Merdeka Senayan |
| Tika | `kasir.kopigbk@example.com` | `trackfud123` | Kopi Senayan Park |
| Wulan | `kasir.gadogbk@example.com` | `trackfud123` | Gado-Gado Sehat Madya |
| Joko | `kasir.ayamgbk@example.com` | `trackfud123` | Ayam Goreng Arena |

**Couriers** (approved, live work session near the stadium after every boot):

| Name | Email | Password | Mode |
| ---- | ----- | -------- | ---- |
| Rizky Pratama | `gbk-runner-1@example.com` | `trackfud123` | runner |
| Dewi Anggraini | `gbk-runner-2@example.com` | `trackfud123` | runner |
| Fajar Nugroho | `gbk-biker-1@example.com` | `trackfud123` | biker |
| Putri Maharani | `gbk-biker-2@example.com` | `trackfud123` | biker |
| Yoga Saputra | `gbk-runner-3@example.com` | `trackfud123` | runner |
| Hendra Gunawan | `gbk-biker-3@example.com` | `trackfud123` | biker |
| Maya Kusuma | `gbk-runner-4@example.com` | `trackfud123` | runner |
| Dimas Arya | `gbk-biker-4@example.com` | `trackfud123` | biker |

To move these couriers around the stadium, run the simulator with an
accounts file (`[{"email":"gbk-runner-1@example.com","mode":"runner"}, …]`)
and the password from the environment, e.g.
`TF_SIM_PASSWORD=trackfud123 go run ./cmd/simulator --accounts gbk.json --routes gbk.geojson`
(flags documented in `backend/cmd/simulator/main.go`).

**Customers** (hotel guests, wallets funded Rp 1.000.000):

| Guest | Email | Password | Hotel pin |
| ----- | ----- | -------- | --------- |
| James Whitfield | `gbk-guest-1@example.com` | `trackfud123` | Hotel Sultan Jakarta |
| Aisha Rahman | `gbk-guest-2@example.com` | `trackfud123` | Hotel Mulia Senayan |
| Kenji Tanaka | `gbk-guest-3@example.com` | `trackfud123` | Fairmont Jakarta |
| Maria Santos | `gbk-guest-4@example.com` | `trackfud123` | Somerset Berlian |
| Daniel Koh | `gbk-guest-5@example.com` | `trackfud123` | Harris Suites fX Sudirman |
| Nadia Putri | `gbk-guest-6@example.com` | `trackfud123` | Century Park Hotel |

## Demo logins — password `DemoPass123!` (demo mode only)

`demo-customer@Trackfud.local`, `demo-merchant@Trackfud.local`,
`demo-courier@Trackfud.local`, `demo-admin@Trackfud.local`,
`demo-judge@Trackfud.local`, plus simulator bots
(`bot-runner-1@`, `bot-biker-2@`, … `@Trackfud.local`).

## Quick login check

```sh
curl -s localhost:8081/v1/auth/login -H 'Content-Type: application/json' \
  -H 'X-TF-App: cms' \
  -d '{"email":"admin@example.com","password":"trackfud123"}'
```

Swap `X-TF-App` (`customer` / `courier` / `merchant` / `cms`) and the
email/password from the tables above. A 200 with tokens means the account is
healthy.
