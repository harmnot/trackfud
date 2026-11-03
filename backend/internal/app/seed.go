package app

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"time"
)

// SeedDemo inserts fictional demo data (idempotent). Jakarta + London only.
func (s *Server) SeedDemo(ctx context.Context) error {
	hash, _ := hashPW("DemoPass123!")
	seedUser := func(email, name, role string) string {
		var id string
		err := s.db.QueryRow(ctx, `INSERT INTO users(email,password_hash,name,email_verified) VALUES($1,$2,$3,true) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING id`, email, hash, name).Scan(&id)
		if err != nil {
			return ""
		}
		_, _ = s.db.Exec(ctx, `INSERT INTO user_roles(user_id,role) VALUES($1,$2) ON CONFLICT DO NOTHING`, id, role)
		return id
	}
	cust := seedUser("demo-customer@Trackfud.local", "Demo Customer", "customer")
	m1 := seedUser("demo-merchant@Trackfud.local", "Demo Merchant", "merchant")
	seedUser("demo-courier@Trackfud.local", "Demo Courier", "courier")
	seedUser("demo-admin@Trackfud.local", "Demo Admin", "admin")
	// B6: judge one-click login (customer wallet below) + simulator bots.
	judge := seedUser("demo-judge@Trackfud.local", "Demo Judge", "customer")
	for _, b := range []struct{ email, name, mode string }{
		{"bot-runner-1@Trackfud.local", "Bot Runner 1", "runner"},
		{"bot-biker-2@Trackfud.local", "Bot Biker 2", "biker"},
		{"bot-runner-3@Trackfud.local", "Bot Runner 3", "runner"},
		{"bot-biker-4@Trackfud.local", "Bot Biker 4", "biker"},
		{"bot-runner-5@Trackfud.local", "Bot Runner 5", "runner"},
		{"bot-biker-6@Trackfud.local", "Bot Biker 6", "biker"},
	} {
		if id := seedUser(b.email, b.name, "courier"); id != "" {
			_, _ = s.db.Exec(ctx, `INSERT INTO couriers(user_id,mode,status,legal_name)
				VALUES($1,$2,'approved',$3)
				ON CONFLICT (user_id) DO UPDATE SET mode=EXCLUDED.mode, status='approved'`, id, b.mode, b.name)
		}
	}
	// Demo wallet: first seed funds the customer so wallet checkout works
	// out of the box; later top-ups persist because of ON CONFLICT DO NOTHING.
	if cust != "" {
		_, _ = s.db.Exec(ctx, `INSERT INTO ledger_accounts(owner_type,owner_id,kind,currency,balance_minor)
			VALUES('customer',$1,'customer_wallet','IDR',200000) ON CONFLICT (owner_type,owner_id,kind,currency) DO NOTHING`, cust)
	}
	if judge != "" {
		_, _ = s.db.Exec(ctx, `INSERT INTO ledger_accounts(owner_type,owner_id,kind,currency,balance_minor)
			VALUES('customer',$1,'customer_wallet','IDR',500000) ON CONFLICT (owner_type,owner_id,kind,currency) DO NOTHING`, judge)
	}
	if err := s.SeedTestAccounts(ctx); err != nil {
		return err
	}
	type seedM struct {
		name, addr, cur, tz string
		lat, lng            float64
	}
	merchants := []seedM{
		{"Warung Sehat Nusantara", "Jl. Sudirman Kav. 21, Jakarta", "IDR", "Asia/Jakarta", -6.2088, 106.8456},
		{"Dapur Lari Pagi", "Jl. Asia Afrika No. 8, Jakarta", "IDR", "Asia/Jakarta", -6.2146, 106.8451},
		{"Borough Greens", "8 Southwark St, London", "GBP", "Europe/London", 51.5055, -0.0910},
	}
	if m1 == "" {
		return nil
	}
	for _, m := range merchants {
		// merchants has no natural unique key (ON CONFLICT never fires), so
		// the store is found by owner+name and only inserted when missing.
		mid := s.demoMerchantID(ctx, m1, m.name)
		if mid == "" {
			if err := s.db.QueryRow(ctx, `INSERT INTO merchants(owner_id,name,currency,timezone,address,location,prep_minutes,status,phone,country) VALUES($1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,12,'approved','+62210000000','ID') RETURNING id`, m1, m.name, m.cur, m.tz, m.addr, m.lng, m.lat).Scan(&mid); err != nil {
				return fmt.Errorf("seed demo merchant %s: %w", m.name, err)
			}
		}
		var n int
		_ = s.db.QueryRow(ctx, `SELECT count(*) FROM menu_items WHERE merchant_id=$1`, mid).Scan(&n)
		if n > 0 {
			continue
		}
		items := []struct {
			en, idn, ms, size string
			price             int64
			tw                bool
		}{
			{"Grilled Chicken Rice Box", "Nasi Ayam Panggang", "Nasi Ayam Bakar", "M", 35000, true},
			{"Tofu Veggie Wrap", "Wrap Tahu Sayur", "Balut Tauhu Sayur", "S", 28000, true},
			{"Iced Tea", "Es Teh Manis", "Teh Ais", "S", 8000, false},
			{"Fruit Salad Cup", "Salad Buah", "Salad Buah", "S", 22000, true},
		}
		if m.cur == "GBP" {
			for i := range items {
				items[i].price = 650 + int64(i*100)
			}
		}
		for _, it := range items {
			name := `{"en":"` + it.en + `","id":"` + it.idn + `","ms":"` + it.ms + `"}`
			_, _ = s.db.Exec(ctx, `INSERT INTO menu_items(merchant_id,name,description,price_minor,size_class,travels_well) VALUES($1,$2,'{}',$3,$4,$5)`, mid, name, it.price, it.size, it.tw)
		}
	}
	return nil
}

// demoMerchantID returns the oldest demo store ownerID owns under name, or
// "" when none exists. Boots before this lookup inserted one extra copy per
// boot/reset; later copies that never took an order are deleted here (their
// menu, staff and agreement rows cascade; orders RESTRICT, so a copy with
// history is never touched), leaving one store per name.
func (s *Server) demoMerchantID(ctx context.Context, ownerID, name string) string {
	var mid string
	if err := s.db.QueryRow(ctx, `SELECT id FROM merchants WHERE owner_id=$1 AND name=$2
		ORDER BY created_at, id LIMIT 1`, ownerID, name).Scan(&mid); err != nil {
		return ""
	}
	if _, err := s.db.Exec(ctx, `DELETE FROM merchants m WHERE m.owner_id=$1 AND m.name=$2 AND m.id<>$3
		AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.merchant_id=m.id)`, ownerID, name, mid); err != nil {
		s.log.Warn("seed demo: duplicate store cleanup failed", "store", name, "err", err)
	}
	return mid
}

// Canonical local-test accounts. Every manual test and every seed run uses
// these emails with password "trackfud123" (see .agents/skills/seed-test-data).
// Idempotent: re-running resets the password and repairs the role (including
// the CMS admin grant), courier, merchant, menu, and wallet rows, so a reseed
// also fixes a broken account.
func (s *Server) SeedTestAccounts(ctx context.Context) error {
	hash, _ := hashPW("trackfud123")
	seedUser := func(email, name, role string) string {
		var id string
		err := s.db.QueryRow(ctx, `INSERT INTO users(email,password_hash,name,email_verified) VALUES($1,$2,$3,true) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, email_verified=true RETURNING id`, email, hash, name).Scan(&id)
		if err != nil {
			return ""
		}
		_, _ = s.db.Exec(ctx, `INSERT INTO user_roles(user_id,role) VALUES($1,$2) ON CONFLICT DO NOTHING`, id, role)
		return id
	}
	cust := seedUser("customer@example.com", "Test Customer", "customer")
	courier := seedUser("runnerbiker@example.com", "Test Runner", "courier")
	merch := seedUser("merchant@example.com", "Test Merchant", "merchant")
	// CMS admin signs into the Back Office review queues with this account.
	seedUser("admin@example.com", "Rina Wijaya", "admin")
	// Courier must be approved to go online and receive dispatch offers.
	if courier != "" {
		_, _ = s.db.Exec(ctx, `INSERT INTO couriers(user_id,mode,status,legal_name,approved_at,approved_by)
			VALUES($1,'runner','approved','Test Runner',now(),'seed')
			ON CONFLICT (user_id) DO UPDATE SET mode='runner', status='approved', legal_name='Test Runner', approved_at=now()`, courier)
	}
	// Customer wallet is funded so wallet checkout works out of the box.
	if cust != "" {
		_, _ = s.db.Exec(ctx, `INSERT INTO ledger_accounts(owner_type,owner_id,kind,currency,balance_minor)
			VALUES('customer',$1,'customer_wallet','IDR',200000) ON CONFLICT (owner_type,owner_id,kind,currency) DO NOTHING`, cust)
	}
	// Merchant owns an approved store with orderable items.
	if merch != "" {
		var mid string
		_ = s.db.QueryRow(ctx, `SELECT id FROM merchants WHERE owner_id=$1 AND name='Warung Test Rasa' LIMIT 1`, merch).Scan(&mid)
		if mid == "" {
			_ = s.db.QueryRow(ctx, `INSERT INTO merchants(owner_id,name,currency,timezone,address,location,prep_minutes,status,phone,country) VALUES($1,'Warung Test Rasa','IDR','Asia/Jakarta','Jl. Sudirman Kav. 21, Jakarta',ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,12,'approved','+62210000000','ID') RETURNING id`, merch, 106.8456, -6.2088).Scan(&mid)
		}
		if mid != "" {
			var n int
			_ = s.db.QueryRow(ctx, `SELECT count(*) FROM menu_items WHERE merchant_id=$1`, mid).Scan(&n)
			if n == 0 {
				for _, it := range []struct {
					en, idn, ms, size string
					price             int64
					tw                bool
				}{
					{"Grilled Chicken Rice Box", "Nasi Ayam Panggang", "Nasi Ayam Bakar", "M", 35000, true},
					{"Tofu Veggie Wrap", "Wrap Tahu Sayur", "Balut Tauhu Sayur", "S", 28000, true},
					{"Fruit Salad Cup", "Salad Buah", "Salad Buah", "S", 22000, true},
				} {
					name := `{"en":"` + it.en + `","id":"` + it.idn + `","ms":"` + it.ms + `"}`
					_, _ = s.db.Exec(ctx, `INSERT INTO menu_items(merchant_id,name,description,price_minor,size_class,travels_well) VALUES($1,$2,'{}',$3,$4,$5)`, mid, name, it.price, it.size, it.tw)
				}
			}
		}
	}
	// Requested local accounts (2026-10-31): approved couriers, approved +
	// signed merchants, and a funded customer so login-gated flows work out
	// of the box. Runs on every boot (demo and non-demo) via SeedTestAccounts.
	if err := s.SeedRequestedAccounts(ctx); err != nil {
		return err
	}
	return nil
}

// requestedCourier is one approved courier profile: every column mirrors what
// the onboarding path writes (storeProfile + submit + decideApplication), so
// the CMS detail and the courier PWA render full data, not stubs.
type requestedCourier struct {
	email, name, phone, mode      string
	legalName, birthDate, nation  string
	street, city, postal          string
	emName, emRelation, emPhone   string
	idDocType, idNumber           string
	bikeType                      string // "" for runners
	bagLiters                     int
	fitDistM                      float64
	fitMovingS, fitElapsedS       int
	deliveries                    int
	ratingBayes                   float64
	ratingCount                   int
	lifetimeDistM                 float64
	lifetimeMovingS, lifetimeActS int64
}

// requestedMerchant is one approved + signed store with its menu.
type requestedMerchant struct {
	email, ownerName, ownerPhone string
	store, phone                 string
	address, pickupNote          string
	lat, lng                     float64
	prepMinutes                  int
	signer                       string
	categories                   []string
	items                        []seedMenuItem
	staffEmail                   string
	// staffName/staffPhone also seed a login for the staff roster row
	// (empty: roster row only, the invite stays open until signup).
	staffName, staffPhone string
}

type seedMenuItem struct {
	en, id, ms, cat, size string
	price                 int64
	travelsWell           bool
}

// SeedRequestedAccounts inserts the requested local accounts (password
// "trackfud123" for all six). Idempotent: re-running resets passwords and
// repairs roles, courier/merchant/menu/wallet rows.
func (s *Server) SeedRequestedAccounts(ctx context.Context) error {
	hash, _ := hashPW("trackfud123")
	now := time.Now().UTC()
	seedUser := func(email, name, phone, role string) string {
		var id string
		err := s.db.QueryRow(ctx, `INSERT INTO users(email,password_hash,name,phone,email_verified) VALUES($1,$2,$3,$4,true)
			ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, phone=EXCLUDED.phone, email_verified=true
			RETURNING id`, email, hash, name, phone).Scan(&id)
		if err != nil {
			return ""
		}
		_, _ = s.db.Exec(ctx, `INSERT INTO user_roles(user_id,role) VALUES($1,$2) ON CONFLICT DO NOTHING`, id, role)
		return id
	}

	for _, c := range []requestedCourier{
		{
			email: "runner@example.com", name: "Andito Prasetyo", phone: "+628121234101", mode: "runner",
			legalName: "Andito Prasetyo", birthDate: "1997-03-14", nation: "ID",
			street: "Jl. Bangka Raya No. 41", city: "Jakarta Selatan", postal: "12720",
			emName: "Sari Prasetyo", emRelation: "spouse", emPhone: "+628121234102",
			idDocType: "KTP", idNumber: "3174000000000001",
			bagLiters: 25,
			fitDistM:  2140, fitMovingS: 782, fitElapsedS: 845,
			deliveries: 37, ratingBayes: 4.8, ratingCount: 29,
			lifetimeDistM: 98400, lifetimeMovingS: 31200, lifetimeActS: 28900,
		},
		{
			email: "biker@example.com", name: "Bimo Adyaksa", phone: "+628121234103", mode: "biker",
			legalName: "Bimo Adyaksa", birthDate: "1994-11-02", nation: "ID",
			street: "Jl. Cipete Raya No. 88", city: "Jakarta Selatan", postal: "12410",
			emName: "Danu Adyaksa", emRelation: "sibling", emPhone: "+628121234104",
			idDocType: "KTP", idNumber: "3174000000000002",
			bikeType: "city", bagLiters: 40,
			fitDistM: 5280, fitMovingS: 1064, fitElapsedS: 1155,
			deliveries: 52, ratingBayes: 4.9, ratingCount: 41,
			lifetimeDistM: 261500, lifetimeMovingS: 58200, lifetimeActS: 54100,
		},
		{
			email: "runner2@example.com", name: "Rizky Maulana", phone: "+628121234105", mode: "runner",
			legalName: "Rizky Maulana", birthDate: "2000-07-22", nation: "ID",
			street: "Jl. Fatmawati Raya No. 12", city: "Jakarta Selatan", postal: "12430",
			emName: "Nur Halimah", emRelation: "parent", emPhone: "+628121234106",
			idDocType: "KTP", idNumber: "3174000000000003",
			bagLiters: 20,
			fitDistM:  2085, fitMovingS: 840, fitElapsedS: 890,
			deliveries: 12, ratingBayes: 4.7, ratingCount: 9,
			lifetimeDistM: 31200, lifetimeMovingS: 11800, lifetimeActS: 10900,
		},
	} {
		uid := seedUser(c.email, c.name, c.phone, "courier")
		if uid == "" {
			continue
		}
		if err := s.seedRequestedCourier(ctx, uid, c, now); err != nil {
			return err
		}
	}

	for _, m := range []requestedMerchant{
		{
			email: "chickenresto@example.com", ownerName: "Dewi Lestari", ownerPhone: "+6281311110101",
			store: "Ayam Geprek Sambal Korek", phone: "+62217550101",
			address:    "Jl. RS Fatmawati Raya No. 15, Cilandak, Jakarta Selatan",
			pickupNote: "Ambil di counter depan, tunjukkan kode pickup.",
			lat:        -6.2895, lng: 106.7967, prepMinutes: 12, signer: "Dewi Lestari",
			categories: []string{"Ayam", "Paket Hemat", "Minuman"},
			items: []seedMenuItem{
				{"Ayam Geprek Original", "Ayam Geprek Original", "Ayam Geprek Original", "Ayam", "M", 18000, true},
				{"Cheese Geprek Chicken", "Ayam Geprek Keju", "Ayam Geprek Keju", "Ayam", "M", 23000, true},
				{"Chicken Rice + Iced Tea Set", "Paket Ayam Nasi Es Teh", "Set Ayam Nasi Teh Ais", "Paket Hemat", "M", 25000, true},
				{"Fried Tempeh", "Tempe Mendoan", "Tempe Goreng", "Paket Hemat", "S", 10000, true},
				{"Sweet Iced Tea", "Es Teh Manis", "Teh Ais", "Minuman", "S", 6000, false},
			},
			staffEmail: "kasir.chicken@example.com",
		},
		{
			email: "noodleresto@example.com", ownerName: "Agus Wijaya", ownerPhone: "+6281311110102",
			store: "Mie Ayam Bangka Asli", phone: "+62217550102",
			address:    "Jl. Cipete Raya No. 27, Kebayoran Baru, Jakarta Selatan",
			pickupNote: "Counter samping kasir, ambil dengan nampan agar tidak tumpah.",
			lat:        -6.2743, lng: 106.7958, prepMinutes: 10, signer: "Agus Wijaya",
			categories: []string{"Mie", "Lauk", "Minuman"},
			items: []seedMenuItem{
				{"Original Chicken Noodles", "Mie Ayam Original", "Mee Ayam Original", "Mie", "M", 17000, true},
				{"Chicken Noodles with Meatballs", "Mie Ayam Bakso", "Mee Ayam Bebola", "Mie", "M", 22000, true},
				{"Sweet Soy Yamin Noodles", "Mie Yamin Manis", "Mee Yamin Manis", "Mie", "M", 19000, true},
				{"Fried Wontons", "Pangsit Goreng", "Wantan Goreng", "Lauk", "S", 12000, true},
				{"Iced Orange", "Es Jeruk", "Oren Ais", "Minuman", "S", 7000, false},
			},
			staffEmail: "kasir.noodle@example.com",
		},
	} {
		uid := seedUser(m.email, m.ownerName, m.ownerPhone, "merchant")
		if uid == "" {
			continue
		}
		if err := s.seedRequestedMerchant(ctx, uid, m); err != nil {
			return err
		}
	}

	// Requested customer: profile + funded wallet + two delivery pins.
	if cust := seedUser("customer2@example.com", "Siti Rahmawati", "+628121234201", "customer"); cust != "" {
		_, _ = s.db.Exec(ctx, `INSERT INTO ledger_accounts(owner_type,owner_id,kind,currency,balance_minor)
			VALUES('customer',$1,'customer_wallet','IDR',200000) ON CONFLICT (owner_type,owner_id,kind,currency) DO NOTHING`, cust)
		var n int
		_ = s.db.QueryRow(ctx, `SELECT count(*) FROM customer_addresses WHERE user_id=$1`, cust).Scan(&n)
		if n == 0 {
			_, _ = s.db.Exec(ctx, `INSERT INTO customer_addresses(user_id,label,address,lat,lng,note,is_default) VALUES
				($1,'Home','Jl. Bangka Raya No. 9, Mampang, Jakarta Selatan',-6.2601,106.8093,'Rumah pagar hijau, sebelah mushola',true),
				($1,'Office','SCBD, Jl. Sudirman Kav. 52-53, Jakarta Selatan',-6.2250,106.8063,'Lobby utama, titip di resepsionis',false)`, cust)
		}
	}
	// GBK district: realistic live data around Gelora Bung Karno for the CMS
	// admin, merchant and courier tracks (incl. the AI surfaces). Runs on
	// every boot; history inserts are one-time, sessions refresh each boot.
	if err := s.SeedGBKDistrict(ctx); err != nil {
		return err
	}
	return nil
}

// seedRequestedCourier writes the approved application + operational courier
// row for one requested courier. ID numbers are fictional placeholders sealed
// with the same AES-GCM path as onboarding (never logged, never returned).
func (s *Server) seedRequestedCourier(ctx context.Context, uid string, c requestedCourier, now time.Time) error {
	_, err := s.db.Exec(ctx, `INSERT INTO courier_applications(user_id,mode,status,fitness_distance_m,fitness_moving_s,fitness_elapsed_s,fitness_passed,fitness_gap_max_s,fitness_evaluated_at,submitted_at,updated_at)
		VALUES($1,$2,'approved',$3,$4,$5,true,12,now(),now(),now())
		ON CONFLICT (user_id) DO UPDATE SET mode=EXCLUDED.mode, status='approved',
			fitness_distance_m=EXCLUDED.fitness_distance_m, fitness_moving_s=EXCLUDED.fitness_moving_s,
			fitness_elapsed_s=EXCLUDED.fitness_elapsed_s, fitness_passed=true,
			fitness_gap_max_s=12, fitness_evaluated_at=now(), submitted_at=now(), updated_at=now()`,
		uid, c.mode, c.fitDistM, c.fitMovingS, c.fitElapsedS)
	if err != nil {
		return err
	}
	addr, _ := json.Marshal(map[string]any{
		"street": c.street, "city": c.city, "province": "DKI Jakarta",
		"postal": c.postal, "country": "ID",
	})
	em, _ := json.Marshal(map[string]any{
		"name": c.emName, "relation": c.emRelation, "phone": c.emPhone,
	})
	bike := map[string]any{}
	if c.bikeType != "" {
		bike = map[string]any{"type": c.bikeType, "no_motor": true, "gears": 7}
	}
	bikeB, _ := json.Marshal(bike)
	cons, _ := json.Marshal(map[string]any{
		"terms":    map[string]any{"version": "v1", "accepted_at": now.Format(time.RFC3339)},
		"privacy":  map[string]any{"version": "v1", "accepted_at": now.Format(time.RFC3339)},
		"location": map[string]any{"version": "v1", "accepted_at": now.Format(time.RFC3339)},
	})
	enc, err := s.encryptID(c.idNumber)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `INSERT INTO couriers(user_id,mode,status,legal_name,birth_date,nationality,address,emergency_contact,
			id_doc_type,id_number_enc,id_number_hash,bike,bag_liters,consents,
			rating_bayes,rating_count,deliveries_count,lifetime_distance_m,lifetime_moving_s,lifetime_active_s,approved_at,approved_by)
		VALUES($1,$2,'approved',$3,$4::date,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,now(),'seed')
		ON CONFLICT (user_id) DO UPDATE SET mode=EXCLUDED.mode, status='approved',
			legal_name=EXCLUDED.legal_name, birth_date=EXCLUDED.birth_date, nationality=EXCLUDED.nationality,
			address=EXCLUDED.address, emergency_contact=EXCLUDED.emergency_contact,
			id_doc_type=EXCLUDED.id_doc_type, id_number_enc=EXCLUDED.id_number_enc, id_number_hash=EXCLUDED.id_number_hash,
			bike=EXCLUDED.bike, bag_liters=EXCLUDED.bag_liters, consents=EXCLUDED.consents,
			rating_bayes=EXCLUDED.rating_bayes, rating_count=EXCLUDED.rating_count,
			deliveries_count=EXCLUDED.deliveries_count, lifetime_distance_m=EXCLUDED.lifetime_distance_m,
			lifetime_moving_s=EXCLUDED.lifetime_moving_s, lifetime_active_s=EXCLUDED.lifetime_active_s,
			approved_at=now(), updated_at=now()`,
		uid, c.mode, c.legalName, c.birthDate, c.nation, string(addr), string(em),
		c.idDocType, enc, hashIDNumber(c.idNumber), string(bikeB), c.bagLiters, string(cons),
		c.ratingBayes, c.ratingCount, c.deliveries, c.lifetimeDistM, c.lifetimeMovingS, c.lifetimeActS)
	return err
}

// seedRequestedMerchant writes the approved store, its signed agreement, menu
// and one on-shift staff row. The agreement snapshot + sha256 reuse the live
// agreementVersion/agreementText constants, so a version bump forces
// re-acceptance instead of silently validating stale seed rows.
func (s *Server) seedRequestedMerchant(ctx context.Context, uid string, m requestedMerchant) error {
	hours, _ := json.Marshal(map[string]any{
		"mon": map[string]string{"open": "09:00", "close": "22:00"},
		"tue": map[string]string{"open": "09:00", "close": "22:00"},
		"wed": map[string]string{"open": "09:00", "close": "22:00"},
		"thu": map[string]string{"open": "09:00", "close": "22:00"},
		"fri": map[string]string{"open": "09:00", "close": "22:00"},
		"sat": map[string]string{"open": "09:00", "close": "22:00"},
		"sun": map[string]string{"open": "10:00", "close": "21:00"},
	})
	var mid string
	err := s.db.QueryRow(ctx, `SELECT id FROM merchants WHERE owner_id=$1 AND name=$2 LIMIT 1`, uid, m.store).Scan(&mid)
	if err != nil || mid == "" {
		err = s.db.QueryRow(ctx, `INSERT INTO merchants(owner_id,name,phone,country,currency,timezone,address,pickup_note,location,prep_minutes,opening_hours,status)
			VALUES($1,$2,$3,'ID','IDR','Asia/Jakarta',$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,$8,$9,'approved')
			RETURNING id`, uid, m.store, m.phone, m.address, m.pickupNote, m.lng, m.lat, m.prepMinutes, string(hours)).Scan(&mid)
		if err != nil {
			return err
		}
	} else {
		_, _ = s.db.Exec(ctx, `UPDATE merchants SET phone=$2, address=$3, pickup_note=$4,
			location=ST_SetSRID(ST_MakePoint($5,$6),4326)::geography, prep_minutes=$7, opening_hours=$8, status='approved', updated_at=now()
			WHERE id=$1`, mid, m.phone, m.address, m.pickupNote, m.lng, m.lat, m.prepMinutes, string(hours))
	}
	// Signed agreement (idempotent per version): same guard as signAgreement.
	var n int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM merchant_agreements WHERE merchant_id=$1 AND version=$2 AND agreed=true`, mid, agreementVersion).Scan(&n)
	if n == 0 {
		sum := fmt.Sprintf("%x", sha256.Sum256([]byte(agreementText)))
		_, _ = s.db.Exec(ctx, `INSERT INTO merchant_agreements(merchant_id,version,signer_name,agreed,sha256,text_snapshot,ip,user_agent)
			VALUES($1,$2,$3,true,$4,$5,'seed','seed')`, mid, agreementVersion, m.signer, sum, agreementText)
	}
	// Categories + items (seeded once per store, like SeedTestAccounts).
	catIDs := map[string]string{}
	for i, name := range m.categories {
		var cid string
		_ = s.db.QueryRow(ctx, `SELECT id FROM menu_categories WHERE merchant_id=$1 AND name->>'en'=$2 LIMIT 1`, mid, name).Scan(&cid)
		if cid == "" {
			_ = s.db.QueryRow(ctx, `INSERT INTO menu_categories(merchant_id,name,sort) VALUES($1,$2,$3) RETURNING id`,
				mid, `{"en":"`+name+`","id":"`+name+`","ms":"`+name+`"}`, i).Scan(&cid)
		}
		if cid != "" {
			catIDs[name] = cid
		}
	}
	var items int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM menu_items WHERE merchant_id=$1`, mid).Scan(&items)
	if items == 0 {
		for _, it := range m.items {
			cid := catIDs[it.cat]
			name := `{"en":"` + it.en + `","id":"` + it.id + `","ms":"` + it.ms + `"}`
			if cid == "" {
				_, _ = s.db.Exec(ctx, `INSERT INTO menu_items(merchant_id,name,description,price_minor,size_class,travels_well)
					VALUES($1,$2,'{}',$3,$4,$5)`, mid, name, it.price, it.size, it.travelsWell)
			} else {
				_, _ = s.db.Exec(ctx, `INSERT INTO menu_items(merchant_id,category_id,name,description,price_minor,size_class,travels_well)
					VALUES($1,$2,$3,'{}',$4,$5,$6)`, mid, cid, name, it.price, it.size, it.travelsWell)
			}
		}
	}
	// One on-shift staff member so staff-fallback dispatch has a target.
	_, _ = s.db.Exec(ctx, `INSERT INTO merchant_staff(merchant_id,email,role,can_deliver,on_shift,status)
		VALUES($1,$2,'staff',true,true,'active')
		ON CONFLICT (merchant_id,email) DO UPDATE SET role='staff', can_deliver=true, on_shift=true, status='active'`,
		mid, m.staffEmail)
	return nil
}

// seedStaffUser creates (or repairs) the account behind one staff roster
// row the way a real invite is accepted: staff sign up in the courier app
// (its signup grants the courier platform role), then linkStaffInvites ties
// the roster row to the account. Without a couriers row the account never
// enters workout dispatch; it logs into the courier app via that role,
// lists its restaurant under /v1/courier/staff/memberships, and receives
// staff-fallback offers (moveToStaffSearch joins users by roster email).
// hash is the caller's seed password hash; every boot resets it.
func (s *Server) seedStaffUser(ctx context.Context, hash, email, name, phone string) error {
	var id string
	if err := s.db.QueryRow(ctx, `INSERT INTO users(email,password_hash,name,phone,email_verified) VALUES($1,$2,$3,$4,true)
		ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash,
			phone=EXCLUDED.phone, email_verified=true
		RETURNING id`, email, hash, name, phone).Scan(&id); err != nil {
		return fmt.Errorf("seed staff user: %w", err)
	}
	if _, err := s.db.Exec(ctx, `INSERT INTO user_roles(user_id,role) VALUES($1,'courier') ON CONFLICT DO NOTHING`, id); err != nil {
		return fmt.Errorf("seed staff role: %w", err)
	}
	return s.linkStaffInvites(ctx, id, email)
}
