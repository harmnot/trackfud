package app

import (
	"context"

	"golang.org/x/crypto/bcrypt"
)

// SeedDemo inserts fictional demo data (idempotent). Jakarta + London only.
func (s *Server) SeedDemo(ctx context.Context) error {
	hash, _ := bcrypt.GenerateFromPassword([]byte("DemoPass123!"), 10)
	seedUser := func(email, name, role string) string {
		var id string
		err := s.db.QueryRow(ctx, `INSERT INTO users(email,password_hash,name,email_verified) VALUES($1,$2,$3,true) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING id`, email, string(hash), name).Scan(&id)
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
	for _, m := range merchants {
		var mid string
		err := s.db.QueryRow(ctx, `INSERT INTO merchants(owner_id,name,currency,timezone,address,location,prep_minutes,status,phone,country) VALUES($1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,12,'approved','+62210000000','ID') ON CONFLICT DO NOTHING RETURNING id`, m1, m.name, m.cur, m.tz, m.addr, m.lng, m.lat).Scan(&mid)
		if err != nil || mid == "" {
			// already seeded: find existing
			_ = s.db.QueryRow(ctx, `SELECT id FROM merchants WHERE name=$1 LIMIT 1`, m.name).Scan(&mid)
			if mid == "" {
				continue
			}
			var n int
			_ = s.db.QueryRow(ctx, `SELECT count(*) FROM menu_items WHERE merchant_id=$1`, mid).Scan(&n)
			if n > 0 {
				continue
			}
		}
		items := []struct {
			en, idn, ms, size, spill string
			price                    int64
			tw                       bool
		}{
			{"Grilled Chicken Rice Box", "Nasi Ayam Panggang", "Nasi Ayam Bakar", "M", "low", 35000, true},
			{"Tofu Veggie Wrap", "Wrap Tahu Sayur", "Balut Tauhu Sayur", "S", "low", 28000, true},
			{"Iced Tea (spill risk)", "Es Teh Manis", "Teh Ais", "S", "high", 8000, false},
			{"Fruit Salad Cup", "Salad Buah", "Salad Buah", "S", "medium", 22000, true},
		}
		if m.cur == "GBP" {
			for i := range items {
				items[i].price = 650 + int64(i*100)
			}
		}
		for _, it := range items {
			name := `{"en":"` + it.en + `","id":"` + it.idn + `","ms":"` + it.ms + `"}`
			_, _ = s.db.Exec(ctx, `INSERT INTO menu_items(merchant_id,name,description,price_minor,size_class,spill_risk,travels_well) VALUES($1,$2,'{}',$3,$4,$5,$6)`, mid, name, it.price, it.size, it.spill, it.tw)
		}
	}
	return nil
}

// Canonical local-test accounts. Every manual test and every seed run uses
// these emails with password "trackfud123" (see .agents/skills/seed-test-data).
// Idempotent: re-running resets the password and repairs the role, courier,
// merchant, menu, and wallet rows, so a reseed also fixes a broken account.
func (s *Server) SeedTestAccounts(ctx context.Context) error {
	hash, _ := bcrypt.GenerateFromPassword([]byte("trackfud123"), 10)
	seedUser := func(email, name, role string) string {
		var id string
		err := s.db.QueryRow(ctx, `INSERT INTO users(email,password_hash,name,email_verified) VALUES($1,$2,$3,true) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, email_verified=true RETURNING id`, email, string(hash), name).Scan(&id)
		if err != nil {
			return ""
		}
		_, _ = s.db.Exec(ctx, `INSERT INTO user_roles(user_id,role) VALUES($1,$2) ON CONFLICT DO NOTHING`, id, role)
		return id
	}
	cust := seedUser("customer@example.com", "Test Customer", "customer")
	courier := seedUser("runnerbiker@example.com", "Test Runner", "courier")
	merch := seedUser("merchant@example.com", "Test Merchant", "merchant")
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
					en, idn, ms, size, spill string
					price                    int64
					tw                       bool
				}{
					{"Grilled Chicken Rice Box", "Nasi Ayam Panggang", "Nasi Ayam Bakar", "M", "low", 35000, true},
					{"Tofu Veggie Wrap", "Wrap Tahu Sayur", "Balut Tauhu Sayur", "S", "low", 28000, true},
					{"Fruit Salad Cup", "Salad Buah", "Salad Buah", "S", "medium", 22000, true},
				} {
					name := `{"en":"` + it.en + `","id":"` + it.idn + `","ms":"` + it.ms + `"}`
					_, _ = s.db.Exec(ctx, `INSERT INTO menu_items(merchant_id,name,description,price_minor,size_class,spill_risk,travels_well) VALUES($1,$2,'{}',$3,$4,$5,$6)`, mid, name, it.price, it.size, it.spill, it.tw)
				}
			}
		}
	}
	return nil
}
