// GBK district seed: realistic live data around Gelora Bung Karno, Jakarta
// (base: -6.2186006, 106.8029661).
//
// This file owns the "lived-in" demo district the CMS admin, merchant, and
// courier AI features read from: approved merchants with real menus (Snap-a-
// Menu / import jobs), approved couriers with sessions + delivery history
// (AI coach, run planner, Trust Briefs, performance page), hotel-guest
// customers (order + chat + translate flows), and a linked order history
// (dashboard numbers, merchant earnings, courier payouts, withdrawals).
//
// All rows are served through the normal API — no frontend hardcodes any of
// this. Idempotent: merchants/couriers/customers upsert by email (a reseed
// repairs passwords/rows); orders + AI extras run once behind an ai_jobs
// guard row; live work sessions refresh on every boot so the CMS live map
// always shows dots near the stadium.
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"Trackfud/internal/ledger"
	"Trackfud/internal/order"
)

// gbkBase is Stadion Utama Gelora Bung Karno.
const gbkBaseLat, gbkBaseLng = -6.2186006, 106.8029661

// gbkSeedGuard marks the one-time GBK order/AI history as done.
const gbkSeedGuardKey = "gbk-district-v1"

// gbkCountry is the district's merchant country (seedRequestedMerchant
// stores every GBK store under ID); it scopes the CMS order-window settings
// the seeded promise reads.
const gbkCountry = "ID"

// SeedGBKDistrict inserts the GBK live-data district. Called from
// SeedTestAccounts so it runs on every boot in demo and non-demo mode.
// The per-boot part (sessions) always refreshes; the history part
// (orders, AI rows) runs once.
func (s *Server) SeedGBKDistrict(ctx context.Context) error {
	merchants, err := s.seedGBKMerchants(ctx)
	if err != nil {
		return err
	}
	couriers, err := s.seedGBKCouriers(ctx)
	if err != nil {
		return err
	}
	customers, err := s.seedGBKCustomers(ctx)
	if err != nil {
		return err
	}
	// Live sessions refresh every boot so the CMS map + dispatch see
	// couriers near the stadium right after a restart.
	if err := s.seedGBKSessions(ctx, couriers); err != nil {
		return err
	}
	// One-time history: orders linking customers→merchants→couriers + AI rows.
	var claimed bool
	err = s.db.QueryRow(ctx, `INSERT INTO ai_jobs(kind,job_key,status,result)
		VALUES('seed',$1,'done','{}') ON CONFLICT (kind,job_key) DO NOTHING RETURNING true`,
		gbkSeedGuardKey).Scan(&claimed)
	if err != nil {
		// ON CONFLICT DO NOTHING with no row → ErrNoRows: already seeded.
		claimed = false
	}
	if !claimed {
		return nil
	}
	if err := s.seedGBKOrders(ctx, merchants, couriers, customers); err != nil {
		return err
	}
	return s.seedGBKAIExtras(ctx, merchants, couriers)
}

// ---------- merchants ----------

type gbkMerchant struct {
	uid, mid string
	lat, lng float64
	prep     int // kitchen prep minutes (drives seeded ready_at_est)
}

func (s *Server) seedGBKMerchants(ctx context.Context) ([]gbkMerchant, error) {
	hash, _ := hashPW("trackfud123")
	seedUser := func(email, name, phone string) string {
		var id string
		err := s.db.QueryRow(ctx, `INSERT INTO users(email,password_hash,name,phone,email_verified)
			VALUES($1,$2,$3,$4,true)
			ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash,
				phone=EXCLUDED.phone, email_verified=true
			RETURNING id`, email, hash, name, phone).Scan(&id)
		if err != nil {
			return ""
		}
		_, _ = s.db.Exec(ctx, `INSERT INTO user_roles(user_id,role) VALUES($1,'merchant') ON CONFLICT DO NOTHING`, id)
		return id
	}
	defs := []requestedMerchant{
		{
			email: "sate.gbk@example.com", ownerName: "Haji Slamet Riyadi", ownerPhone: "+6281111110101",
			store: "Sate Senayan GBK", phone: "+62215790101",
			address: "Jl. Asia Afrika No. 8, Gelora, Jakarta Pusat", pickupNote: "Counter depan, sebelah kasir — tunjukkan kode pickup.",
			lat: -6.2198, lng: 106.7992, prepMinutes: 15, signer: "Haji Slamet Riyadi",
			categories: []string{"Sate", "Sop & Soto", "Minuman"},
			items: []seedMenuItem{
				{"Chicken Satay (10 skewers)", "Sate Ayam (10 tusuk)", "Sate Ayam (10 cucuk)", "Sate", "M", 32000, true},
				{"Beef Satay (10 skewers)", "Sate Sapi (10 tusuk)", "Sate Lembu (10 cucuk)", "Sate", "M", 38000, true},
				{"Satay Rice Set + Iced Tea", "Paket Sate Nasi Es Teh", "Set Sate Nasi Teh Ais", "Sate", "M", 42000, true},
				{"Oxtail Soup", "Sop Buntut", "Sup Ekor", "Sop & Soto", "M", 45000, true},
				{"Chicken Soto Bowl", "Soto Ayam", "Soto Ayam", "Sop & Soto", "M", 25000, true},
				{"Sweet Iced Tea", "Es Teh Manis", "Teh Ais", "Minuman", "S", 8000, false},
			},
			staffEmail: "kasir.sategbk@example.com", staffName: "Sari", staffPhone: "+6281444440101",
		},
		{
			email: "bakmi.gbk@example.com", ownerName: "Lina Hartono", ownerPhone: "+6281111110102",
			store: "Bakmi Ayam GBK", phone: "+62215790102",
			address: "Jl. Pintu Satu Senayan No. 3, Jakarta Pusat", pickupNote: "Ambil di jendela samping, pakai nampan agar tidak tumpah.",
			lat: -6.2168, lng: 106.8008, prepMinutes: 10, signer: "Lina Hartono",
			categories: []string{"Bakmi", "Lauk", "Minuman"},
			items: []seedMenuItem{
				{"Chicken Noodles Original", "Bakmi Ayam Original", "Mee Ayam Original", "Bakmi", "M", 22000, true},
				{"Chicken Noodles + Meatballs", "Bakmi Ayam Bakso", "Mee Ayam Bebola", "Bakmi", "M", 28000, true},
				{"Sweet Soy Yamin Noodles", "Bakmi Yamin Manis", "Mee Yamin Manis", "Bakmi", "M", 24000, true},
				{"Fried Wontons (5 pcs)", "Pangsit Goreng (5 pcs)", "Wantan Goreng (5 pcs)", "Lauk", "S", 15000, true},
				{"Iced Orange", "Es Jeruk", "Oren Ais", "Minuman", "S", 9000, false},
			},
			staffEmail: "kasir.bakmigbk@example.com", staffName: "Budi", staffPhone: "+6281444440102",
		},
		{
			email: "padang.gbk@example.com", ownerName: "Yusrizal Dt. Mudo", ownerPhone: "+6281111110103",
			store: "Nasi Padang Merdeka Senayan", phone: "+62215790103",
			address: "Jl. Gerbang Pemuda No. 5, Senayan, Jakarta Pusat", pickupNote: "Counter bungkus, sebut nama pemesan.",
			lat: -6.2218, lng: 106.8052, prepMinutes: 12, signer: "Yusrizal Dt. Mudo",
			categories: []string{"Nasi Padang", "Lauk", "Minuman"},
			items: []seedMenuItem{
				{"Padang Rice + Rendang", "Nasi Padang Rendang", "Nasi Padang Rendang", "Nasi Padang", "M", 30000, true},
				{"Padang Rice + Fried Chicken", "Nasi Padang Ayam Goreng", "Nasi Padang Ayam Goreng", "Nasi Padang", "M", 28000, true},
				{"Beef Rendang (single)", "Rendang Sapi", "Rendang Lembu", "Lauk", "S", 20000, true},
				{"Cassava Leaves", "Daun Singkong", "Daun Ubi", "Lauk", "S", 10000, true},
				{"Iced Cendol", "Es Cendol", "Cendol Ais", "Minuman", "S", 12000, false},
			},
			staffEmail: "kasir.padanggbk@example.com", staffName: "Rahmat", staffPhone: "+6281444440103",
		},
		{
			email: "kopi.gbk@example.com", ownerName: "Nadia Prameswari", ownerPhone: "+6281111110104",
			store: "Kopi Senayan Park", phone: "+62215790104",
			address: "Senayan Park, Jl. Gerbang Pemuda No. 62, Jakarta Pusat", pickupNote: "Pickup counter lantai LG, sebelah eskalator.",
			lat: -6.2155, lng: 106.8065, prepMinutes: 8, signer: "Nadia Prameswari",
			categories: []string{"Kopi", "Non-Kopi", "Snack"},
			items: []seedMenuItem{
				{"Palm Sugar Iced Coffee", "Kopi Susu Gula Aren", "Kopi Susu Gula Melaka", "Kopi", "S", 22000, true},
				{"Americano (hot/iced)", "Americano (panas/dingin)", "Americano (panas/sejuk)", "Kopi", "S", 20000, true},
				{"Matcha Latte", "Matcha Latte", "Matcha Latte", "Non-Kopi", "S", 25000, true},
				{"Banana Crispy", "Pisang Crispy", "Pisang Rangup", "Snack", "S", 18000, true},
				{"Chicken Katsu Rice Bowl", "Rice Bowl Chicken Katsu", "Rice Bowl Ayam Katsu", "Snack", "M", 32000, true},
			},
			staffEmail: "kasir.kopigbk@example.com", staffName: "Tika", staffPhone: "+6281444440104",
		},
		{
			email: "gado.gbk@example.com", ownerName: "Suryani Wulandari", ownerPhone: "+6281111110105",
			store: "Gado-Gado Sehat Madya", phone: "+62215790105",
			address: "Jl. Stadion Madya No. 12, Senayan, Jakarta Pusat", pickupNote: "Warung hijau, ambil di meja depan.",
			lat: -6.2232, lng: 106.8002, prepMinutes: 10, signer: "Suryani Wulandari",
			categories: []string{"Sehat", "Lauk", "Minuman"},
			items: []seedMenuItem{
				{"Gado-Gado Jakarta", "Gado-Gado Jakarta", "Gado-Gado Jakarta", "Sehat", "M", 24000, true},
				{"Pecel Rice + Peanut Sauce", "Nasi Pecel", "Nasi Pecel", "Sehat", "M", 22000, true},
				{"Fruit Salad Cup", "Salad Buah", "Salad Buah", "Sehat", "S", 22000, true},
				{"Fried Tempeh", "Tempe Mendoan", "Tempe Goreng", "Lauk", "S", 12000, true},
				{"Young Coconut Ice", "Es Kelapa Muda", "Air Kelapa Ais", "Minuman", "S", 15000, false},
			},
			staffEmail: "kasir.gadogbk@example.com", staffName: "Wulan", staffPhone: "+6281444440105",
		},
		{
			email: "ayam.gbk@example.com", ownerName: "Bambang Sutrisno", ownerPhone: "+6281111110106",
			store: "Ayam Goreng Arena", phone: "+62215790106",
			address: "Jl. Pintu Tujuh Senayan No. 2, Jakarta Pusat", pickupNote: "Outlet pojok arena, kasir 2.",
			lat: -6.2202, lng: 106.8092, prepMinutes: 12, signer: "Bambang Sutrisno",
			categories: []string{"Ayam", "Paket Hemat", "Minuman"},
			items: []seedMenuItem{
				{"Crispy Fried Chicken", "Ayam Goreng Crispy", "Ayam Goreng Rangup", "Ayam", "M", 20000, true},
				{"Chicken Rice + Iced Tea Set", "Paket Ayam Nasi Es Teh", "Set Ayam Nasi Teh Ais", "Paket Hemat", "M", 28000, true},
				{"Chicken Geprek", "Ayam Geprek", "Ayam Geprek", "Ayam", "M", 22000, true},
				{"French Fries", "Kentang Goreng", "Kentang Goreng", "Paket Hemat", "S", 14000, true},
				{"Lemon Tea (hot/iced)", "Teh Lemon (panas/dingin)", "Teh Lemon (panas/sejuk)", "Minuman", "S", 10000, false},
			},
			staffEmail: "kasir.ayamgbk@example.com", staffName: "Joko", staffPhone: "+6281444440106",
		},
	}
	out := make([]gbkMerchant, 0, len(defs))
	for _, m := range defs {
		uid := seedUser(m.email, m.ownerName, m.ownerPhone)
		if uid == "" {
			continue
		}
		if err := s.seedRequestedMerchant(ctx, uid, m); err != nil {
			return nil, err
		}
		// The kasir roster row (can_deliver + on_shift) gets a real login so
		// staff fallback is demoable end to end; repaired every boot.
		if m.staffName != "" {
			if err := s.seedStaffUser(ctx, hash, m.staffEmail, m.staffName, m.staffPhone); err != nil {
				return nil, err
			}
		}
		var mid string
		_ = s.db.QueryRow(ctx, `SELECT id FROM merchants WHERE owner_id=$1 AND name=$2 LIMIT 1`, uid, m.store).Scan(&mid)
		if mid == "" {
			continue
		}
		out = append(out, gbkMerchant{uid: uid, mid: mid, lat: m.lat, lng: m.lng, prep: m.prepMinutes})
	}
	return out, nil
}

// ---------- couriers ----------

type gbkCourier struct {
	uid      string
	mode     string
	lat, lng float64
}

func (s *Server) seedGBKCouriers(ctx context.Context) ([]gbkCourier, error) {
	hash, _ := hashPW("trackfud123")
	now := time.Now().UTC()
	seedUser := func(email, name, phone string) string {
		var id string
		err := s.db.QueryRow(ctx, `INSERT INTO users(email,password_hash,name,phone,email_verified) VALUES($1,$2,$3,$4,true)
			ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash,
				phone=EXCLUDED.phone, email_verified=true
			RETURNING id`, email, hash, name, phone).Scan(&id)
		if err != nil {
			return ""
		}
		_, _ = s.db.Exec(ctx, `INSERT INTO user_roles(user_id,role) VALUES($1,'courier') ON CONFLICT DO NOTHING`, id)
		return id
	}
	defs := []struct {
		c        requestedCourier
		lat, lng float64
	}{
		{requestedCourier{email: "gbk-runner-1@example.com", name: "Rizky Pratama", phone: "+6281222220101", mode: "runner", legalName: "Rizky Pratama", birthDate: "1998-05-11", nation: "ID", street: "Jl. Gelora No. 10", city: "Jakarta Pusat", postal: "10270", emName: "Ayu Pratama", emRelation: "sibling", emPhone: "+6281222220102", idDocType: "KTP", idNumber: "3174000000000011", bagLiters: 25, fitDistM: 2230, fitMovingS: 801, fitElapsedS: 872, deliveries: 64, ratingBayes: 4.8, ratingCount: 51, lifetimeDistM: 148200, lifetimeMovingS: 48600, lifetimeActS: 44900}, -6.2175, 106.8015},
		{requestedCourier{email: "gbk-runner-2@example.com", name: "Dewi Anggraini", phone: "+6281222220103", mode: "runner", legalName: "Dewi Anggraini", birthDate: "1996-09-03", nation: "ID", street: "Jl. Asia Afrika No. 21", city: "Jakarta Pusat", postal: "10270", emName: "Budi Anggraini", emRelation: "spouse", emPhone: "+6281222220104", idDocType: "KTP", idNumber: "3174000000000012", bagLiters: 20, fitDistM: 2115, fitMovingS: 795, fitElapsedS: 860, deliveries: 48, ratingBayes: 4.9, ratingCount: 39, lifetimeDistM: 112600, lifetimeMovingS: 37400, lifetimeActS: 34800}, -6.2205, 106.8035},
		{requestedCourier{email: "gbk-biker-1@example.com", name: "Fajar Nugroho", phone: "+6281222220105", mode: "biker", legalName: "Fajar Nugroho", birthDate: "1995-02-27", nation: "ID", street: "Jl. Senayan No. 33", city: "Jakarta Selatan", postal: "12190", emName: "Rina Nugroho", emRelation: "spouse", emPhone: "+6281222220106", idDocType: "KTP", idNumber: "3174000000000013", bikeType: "city", bagLiters: 40, fitDistM: 5340, fitMovingS: 1092, fitElapsedS: 1180, deliveries: 91, ratingBayes: 4.9, ratingCount: 74, lifetimeDistM: 312400, lifetimeMovingS: 69800, lifetimeActS: 64900}, -6.2240, 106.8000},
		{requestedCourier{email: "gbk-biker-2@example.com", name: "Putri Maharani", phone: "+6281222220107", mode: "biker", legalName: "Putri Maharani", birthDate: "1999-12-19", nation: "ID", street: "Jl. Suryo No. 8", city: "Jakarta Selatan", postal: "12180", emName: "Dedi Maharani", emRelation: "parent", emPhone: "+6281222220108", idDocType: "KTP", idNumber: "3174000000000014", bikeType: "city", bagLiters: 35, fitDistM: 5120, fitMovingS: 1115, fitElapsedS: 1210, deliveries: 57, ratingBayes: 4.7, ratingCount: 44, lifetimeDistM: 198700, lifetimeMovingS: 46200, lifetimeActS: 42900}, -6.2260, 106.8060},
		{requestedCourier{email: "gbk-runner-3@example.com", name: "Yoga Saputra", phone: "+6281222220109", mode: "runner", legalName: "Yoga Saputra", birthDate: "2001-04-08", nation: "ID", street: "Jl. Palmerah Selatan No. 5", city: "Jakarta Barat", postal: "10270", emName: "Sinta Saputra", emRelation: "sibling", emPhone: "+6281222220110", idDocType: "KTP", idNumber: "3174000000000015", bagLiters: 20, fitDistM: 2050, fitMovingS: 830, fitElapsedS: 905, deliveries: 22, ratingBayes: 4.6, ratingCount: 17, lifetimeDistM: 52100, lifetimeMovingS: 17800, lifetimeActS: 16500}, -6.2140, 106.7995},
		{requestedCourier{email: "gbk-biker-3@example.com", name: "Hendra Gunawan", phone: "+6281222220111", mode: "biker", legalName: "Hendra Gunawan", birthDate: "1993-07-30", nation: "ID", street: "Jl. Tentara Pelajar No. 44", city: "Jakarta Selatan", postal: "12210", emName: "Wulan Gunawan", emRelation: "spouse", emPhone: "+6281222220112", idDocType: "KTP", idNumber: "3174000000000016", bikeType: "city", bagLiters: 45, fitDistM: 5480, fitMovingS: 1058, fitElapsedS: 1140, deliveries: 78, ratingBayes: 4.8, ratingCount: 62, lifetimeDistM: 274900, lifetimeMovingS: 61300, lifetimeActS: 57100}, -6.2275, 106.8030},
		{requestedCourier{email: "gbk-runner-4@example.com", name: "Maya Kusuma", phone: "+6281222220113", mode: "runner", legalName: "Maya Kusuma", birthDate: "1997-11-25", nation: "ID", street: "Jl. Gelora Senayan No. 7", city: "Jakarta Pusat", postal: "10270", emName: "Rio Kusuma", emRelation: "spouse", emPhone: "+6281222220114", idDocType: "KTP", idNumber: "3174000000000017", bagLiters: 25, fitDistM: 2180, fitMovingS: 788, fitElapsedS: 855, deliveries: 35, ratingBayes: 4.9, ratingCount: 28, lifetimeDistM: 84300, lifetimeMovingS: 27900, lifetimeActS: 25800}, -6.2190, 106.8070},
		{requestedCourier{email: "gbk-biker-4@example.com", name: "Dimas Arya", phone: "+6281222220115", mode: "biker", legalName: "Dimas Arya", birthDate: "2000-01-15", nation: "ID", street: "Jl. Patal Senayan No. 19", city: "Jakarta Selatan", postal: "12210", emName: "Ratna Arya", emRelation: "parent", emPhone: "+6281222220116", idDocType: "KTP", idNumber: "3174000000000018", bikeType: "city", bagLiters: 40, fitDistM: 5260, fitMovingS: 1108, fitElapsedS: 1195, deliveries: 41, ratingBayes: 4.7, ratingCount: 33, lifetimeDistM: 143800, lifetimeMovingS: 33400, lifetimeActS: 31100}, -6.2225, 106.8095},
	}
	out := make([]gbkCourier, 0, len(defs))
	for _, d := range defs {
		uid := seedUser(d.c.email, d.c.name, d.c.phone)
		if uid == "" {
			continue
		}
		if err := s.seedRequestedCourier(ctx, uid, d.c, now); err != nil {
			return nil, err
		}
		out = append(out, gbkCourier{uid: uid, mode: d.c.mode, lat: d.lat, lng: d.lng})
	}
	return out, nil
}

// ---------- customers (hotel guests near GBK) ----------

type gbkCustomer struct {
	uid       string
	addrID    string
	lat, lng  float64
	hotel, rm string
}

func (s *Server) seedGBKCustomers(ctx context.Context) ([]gbkCustomer, error) {
	hash, _ := hashPW("trackfud123")
	seedUser := func(email, name, phone string) string {
		var id string
		err := s.db.QueryRow(ctx, `INSERT INTO users(email,password_hash,name,phone,email_verified) VALUES($1,$2,$3,$4,true)
			ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash,
				phone=EXCLUDED.phone, email_verified=true
			RETURNING id`, email, hash, name, phone).Scan(&id)
		if err != nil {
			return ""
		}
		_, _ = s.db.Exec(ctx, `INSERT INTO user_roles(user_id,role) VALUES($1,'customer') ON CONFLICT DO NOTHING`, id)
		return id
	}
	defs := []struct {
		email, name, phone, label, addr, note string
		lat, lng                              float64
		def                                   bool
	}{
		{"gbk-guest-1@example.com", "James Whitfield", "+6281333330101", "Hotel Sultan — Tower A", "Hotel Sultan Jakarta, Jl. Gatot Subroto, Tanah Abang", "Room 1204, call on arrival — staying in, please deliver to room", -6.2208, 106.8075, true},
		{"gbk-guest-2@example.com", "Aisha Rahman", "+6281333330102", "Hotel Mulia", "Hotel Mulia Senayan, Jl. Asia Afrika, Gelora", "Room 808, lobby drop if no answer", -6.2216, 106.7975, true},
		{"gbk-guest-3@example.com", "Kenji Tanaka", "+6281333330103", "Fairmont Jakarta", "Fairmont Jakarta, Jl. Asia Afrika No. 8, Senayan", "Room 1502, leave at door, do not knock twice", -6.2245, 106.8078, true},
		{"gbk-guest-4@example.com", "Maria Santos", "+6281333330104", "Somerset Berlian", "Somerset Berlian, Jl. Permata Berlian V, Simprug", "Unit 09C via concierge", -6.2222, 106.8062, true},
		{"gbk-guest-5@example.com", "Daniel Koh", "+6281333330105", "Harris fX Sudirman", "Harris Suites fX Sudirman, Jl. Jenderal Sudirman", "Room 711, lobby if no answer", -6.2252, 106.8085, true},
		{"gbk-guest-6@example.com", "Nadia Putri", "+6281333330106", "Century Park Hotel", "Century Park Hotel, Jl. Pintu Satu Senayan No. 73", "Room 505, WA on arrival", -6.2178, 106.7990, true},
	}
	out := make([]gbkCustomer, 0, len(defs))
	for _, d := range defs {
		uid := seedUser(d.email, d.name, d.phone)
		if uid == "" {
			continue
		}
		// Funded wallet so wallet checkout works out of the box.
		_, _ = s.db.Exec(ctx, `INSERT INTO ledger_accounts(owner_type,owner_id,kind,currency,balance_minor)
			VALUES('customer',$1,'customer_wallet','IDR',1000000) ON CONFLICT (owner_type,owner_id,kind,currency) DO NOTHING`, uid)
		var addrID string
		_ = s.db.QueryRow(ctx, `SELECT id FROM customer_addresses WHERE user_id=$1 AND label=$2 LIMIT 1`, uid, d.label).Scan(&addrID)
		if addrID == "" {
			_ = s.db.QueryRow(ctx, `INSERT INTO customer_addresses(user_id,label,address,lat,lng,note,is_default)
				VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
				uid, d.label, d.addr, d.lat, d.lng, d.note, d.def).Scan(&addrID)
		} else {
			_, _ = s.db.Exec(ctx, `UPDATE customer_addresses SET address=$2, lat=$3, lng=$4, note=$5, is_default=$6 WHERE id=$1`,
				addrID, d.addr, d.lat, d.lng, d.note, d.def)
		}
		out = append(out, gbkCustomer{uid: uid, addrID: addrID, lat: d.lat, lng: d.lng, hotel: d.label, rm: d.note})
	}
	return out, nil
}

// ---------- live sessions (refreshed every boot) ----------

// seedGBKSessions keeps one active work session per GBK courier with a fresh
// fix near the stadium, so the CMS live map, dispatch corridors and the
// performance page always have current dots — even right after a restart.
func (s *Server) seedGBKSessions(ctx context.Context, couriers []gbkCourier) error {
	for i, c := range couriers {
		// Slight deterministic jitter so dots spread around the stadium.
		lat := c.lat + float64((i%3)-1)*0.0009
		lng := c.lng + float64((i%2)*2-1)*0.0011
		var sid string
		_ = s.db.QueryRow(ctx, `SELECT id FROM activity_sessions
			WHERE courier_id=$1 AND kind='work' AND status='active' ORDER BY started_at DESC LIMIT 1`, c.uid).Scan(&sid)
		if sid == "" {
			_ = s.db.QueryRow(ctx, `INSERT INTO activity_sessions(courier_id,kind,mode,status,started_at,
				goal_distance_m,goal_duration_s,distance_m,moving_s,active_s,elapsed_s,
				last_pos,last_seen_at,last_point_ts)
				VALUES($1,'work',$2,'active',now()-interval '42 minutes',
				5000,3600,2350,1320,1500,2520,
				ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,now(),now()) RETURNING id`,
				c.uid, c.mode, lng, lat).Scan(&sid)
		} else {
			_, _ = s.db.Exec(ctx, `UPDATE activity_sessions SET mode=$2,
				last_pos=ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,
				last_seen_at=now(), last_point_ts=now(), status='active', ended_at=NULL,
				distance_m=distance_m+180, moving_s=moving_s+95, active_s=active_s+110, elapsed_s=elapsed_s+120,
				updated_at=now() WHERE id=$1`, sid, c.mode, lng, lat)
		}
		// A couple of ended sessions per courier feed the WHO-week trend,
		// overexertion guards and lifetime stats on the performance page.
		var n int
		_ = s.db.QueryRow(ctx, `SELECT count(*) FROM activity_sessions
			WHERE courier_id=$1 AND kind='work' AND status='ended'`, c.uid).Scan(&n)
		if n == 0 {
			for d := 1; d <= 3; d++ {
				_, _ = s.db.Exec(ctx, `INSERT INTO activity_sessions(courier_id,kind,mode,status,
					started_at,ended_at,goal_distance_m,goal_duration_s,
					distance_m,moving_s,active_s,elapsed_s,
					last_pos,last_seen_at,last_point_ts)
					VALUES($1,'work',$2,'ended',
					now()-make_interval(days => $3)-interval '2 hours',
					now()-make_interval(days => $3)-interval '55 minutes',
					5000,3600,4200+$3*160,2400+$3*40,2700+$3*40,4500+$3*60,
					ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,
					now()-make_interval(days => $3)-interval '55 minutes',
					now()-make_interval(days => $3)-interval '55 minutes')`,
					c.uid, c.mode, d*2, lng, lat)
			}
		}
	}
	return nil
}

// ---------- orders ----------

type gbkMenuItem struct {
	id    string
	price int64
	size  string
	name  []byte
}

func gbkHaversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const r = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * r * math.Asin(math.Sqrt(a))
}

// seedGBKOrders writes one linked history: every order has a real customer
// (hotel guest), a real GBK merchant, real menu items, a real quote, ledger
// postings, a delivery row and dispatch offers — so courier history,
// merchant earnings, the CMS dashboard and the AI pages all read the same
// story. Runs once (guarded by the ai_jobs seed row).
func (s *Server) seedGBKOrders(ctx context.Context, merchants []gbkMerchant, couriers []gbkCourier, customers []gbkCustomer) error {
	if len(merchants) == 0 || len(couriers) == 0 || len(customers) == 0 {
		return nil
	}
	// Load each merchant's orderable menu once.
	menus := map[string][]gbkMenuItem{}
	for _, m := range merchants {
		rows, err := s.db.Query(ctx, `SELECT id, name, price_minor, size_class FROM menu_items
			WHERE merchant_id=$1 AND available AND travels_well ORDER BY price_minor`, m.mid)
		if err != nil {
			continue
		}
		var items []gbkMenuItem
		for rows.Next() {
			var it gbkMenuItem
			if err := rows.Scan(&it.id, &it.name, &it.price, &it.size); err == nil {
				items = append(items, it)
			}
		}
		rows.Close()
		if len(items) > 0 {
			menus[m.mid] = items
		}
	}
	if len(menus) == 0 {
		return nil
	}

	type plan struct {
		cust, merch, cour int
		status            string
		daysAgo           int
		hoursAgoToday     int // for today's active/delivered rows
		qtyA, qtyB        int
		tip               int64
		rate              int // courier stars (0 = unrated)
		cheer             string
		msg               string
		msgLang           string
		translated        string
		cancelReason      string
	}
	plans := []plan{
		// Delivered history (past days) — spread across couriers.
		{cust: 0, merch: 0, cour: 0, status: "delivered", daysAgo: 8, qtyA: 2, qtyB: 1, tip: 5000, rate: 5, cheer: "Semangat pagi! Thanks for the fast run!"},
		{cust: 1, merch: 1, cour: 2, status: "delivered", daysAgo: 7, qtyA: 1, qtyB: 2, tip: 3000, rate: 5, msg: "Tolong titip di concierge ya", msgLang: "id", translated: "Please leave it with the concierge"},
		{cust: 2, merch: 3, cour: 3, status: "delivered", daysAgo: 6, qtyA: 2, qtyB: 0, tip: 4000, rate: 4},
		{cust: 3, merch: 2, cour: 4, status: "delivered", daysAgo: 6, qtyA: 1, qtyB: 1, tip: 2000, rate: 5, cheer: "Great delivery, still hot!"},
		{cust: 4, merch: 5, cour: 5, status: "delivered", daysAgo: 5, qtyA: 3, qtyB: 0, tip: 5000, rate: 5},
		{cust: 5, merch: 4, cour: 6, status: "delivered", daysAgo: 4, qtyA: 1, qtyB: 1, tip: 3000, rate: 4, msg: "Room 505, WA on arrival please", msgLang: "en", translated: "Kamar 505, tolong WA saat tiba"},
		{cust: 0, merch: 2, cour: 7, status: "delivered", daysAgo: 3, qtyA: 2, qtyB: 2, tip: 6000, rate: 5, cheer: "Makasih banyak, cepat sekali!"},
		{cust: 1, merch: 4, cour: 1, status: "delivered", daysAgo: 2, qtyA: 1, qtyB: 0, tip: 2000, rate: 5},
		{cust: 2, merch: 0, cour: 0, status: "delivered", daysAgo: 1, qtyA: 1, qtyB: 1, tip: 4000, rate: 4, msg: "Leave at door, do not knock twice", msgLang: "en", translated: "Taruh di depan pintu, jangan ketuk dua kali"},
		// Completed (settled past orders).
		{cust: 3, merch: 1, cour: 2, status: "completed", daysAgo: 9, qtyA: 2, qtyB: 1, tip: 3000, rate: 5},
		{cust: 4, merch: 0, cour: 5, status: "completed", daysAgo: 7, qtyA: 1, qtyB: 1, tip: 2000, rate: 5, cheer: "Thanks for braving the match-night traffic!"},
		{cust: 5, merch: 3, cour: 3, status: "completed", daysAgo: 5, qtyA: 2, qtyB: 0, tip: 4000, rate: 4},
		{cust: 0, merch: 5, cour: 7, status: "completed", daysAgo: 4, qtyA: 1, qtyB: 2, tip: 3000, rate: 5},
		// Today's live board: 3 delivered already (dashboard GMV), actives.
		{cust: 1, merch: 0, cour: 1, status: "delivered", hoursAgoToday: 5, qtyA: 2, qtyB: 0, tip: 5000, rate: 5},
		{cust: 2, merch: 5, cour: 6, status: "delivered", hoursAgoToday: 3, qtyA: 1, qtyB: 1, tip: 2000, rate: 5, msg: "Thank you!", msgLang: "en", translated: "Terima kasih!"},
		{cust: 3, merch: 3, cour: 4, status: "delivered", hoursAgoToday: 1, qtyA: 1, qtyB: 0, tip: 3000, rate: 0},
		{cust: 4, merch: 1, cour: 2, status: "picked_up", hoursAgoToday: 1, qtyA: 2, qtyB: 1, tip: 3000},
		{cust: 5, merch: 2, cour: 0, status: "picked_up", hoursAgoToday: 1, qtyA: 1, qtyB: 1, tip: 2000},
		{cust: 0, merch: 4, cour: 3, status: "ready", hoursAgoToday: 1, qtyA: 1, qtyB: 1, tip: 4000},
		{cust: 1, merch: 5, cour: 7, status: "ready", hoursAgoToday: 0, qtyA: 2, qtyB: 0, tip: 2000},
		{cust: 2, merch: 1, cour: 5, status: "accepted", hoursAgoToday: 0, qtyA: 1, qtyB: 2, tip: 3000},
		{cust: 3, merch: 0, cour: 6, status: "accepted", hoursAgoToday: 0, qtyA: 2, qtyB: 0, tip: 5000},
		{cust: 4, merch: 3, cour: -1, status: "placed", hoursAgoToday: 0, qtyA: 1, qtyB: 1, tip: 2000},
		{cust: 5, merch: 4, cour: -1, status: "placed", hoursAgoToday: 0, qtyA: 2, qtyB: 0, tip: 1000},
		{cust: 0, merch: 2, cour: -1, status: "placed", hoursAgoToday: 0, qtyA: 1, qtyB: 0, tip: 0},
		// Cancelled (refund path exercised).
		{cust: 1, merch: 1, cour: -1, status: "cancelled", hoursAgoToday: 2, qtyA: 1, qtyB: 0, tip: 0, cancelReason: "customer changed mind before accept"},
		{cust: 4, merch: 2, cour: -1, status: "cancelled", daysAgo: 2, qtyA: 2, qtyB: 0, tip: 0, cancelReason: "merchant rejected: sold out"},
	}
	now := time.Now().UTC()
	// Orders that reached accept carry the promise the live accept writes:
	// prep → ready_at_est, CMS delivery window → window_start/window_end
	// (in-window rates on the dashboard and Ops Copilot read window_end).
	_, winMin, winMax := s.effectiveOrderWindows(ctx, gbkCountry)
	for i, p := range plans {
		cu := customers[p.cust%len(customers)]
		me := merchants[p.merch%len(merchants)]
		timing := acceptTiming{PrepMin: me.prep, WindowMinMin: winMin, WindowMaxMin: winMax}
		items, ok := menus[me.mid]
		if !ok || len(items) == 0 {
			continue
		}
		pick := []gbkMenuItem{items[i%len(items)]}
		if p.qtyB > 0 && len(items) > 1 {
			pick = append(pick, items[(i+2)%len(items)])
		}
		qtys := []int{p.qtyA, p.qtyB}
		var subtotal int64
		worst := 0
		rank := map[string]int{"S": 0, "M": 1, "L": 2}
		for j, it := range pick {
			subtotal += it.price * int64(qtys[j])
			if rank[it.size] > worst {
				worst = rank[it.size]
			}
		}
		sizes := []string{"S", "M", "L"}
		distKm := gbkHaversineKm(me.lat, me.lng, cu.lat, cu.lng)
		if distKm < 0.3 {
			distKm = 0.3
		}
		q := order.QuoteFor(order.QuoteInput{SubtotalMinor: subtotal, DistanceKm: distKm, Currency: "IDR", TipMinor: p.tip})
		code, pin, err := newOrderSecrets()
		if err != nil {
			continue
		}
		pickup := randomDigits(6)
		created := now.Add(-time.Duration(p.daysAgo) * 24 * time.Hour)
		if p.daysAgo == 0 {
			created = now.Add(-time.Duration(p.hoursAgoToday) * time.Hour).Add(-time.Duration(i*7) * time.Minute)
		}
		idem := fmt.Sprintf("gbk-seed-%02d", i)
		var courierID *string
		if p.cour >= 0 {
			c := couriers[p.cour%len(couriers)]
			courierID = &c.uid
		}
		if err := s.insertGBKOrder(ctx, idem, code, pin, pickup, cu, me.mid, timing, pick, qtys, q,
			sizes[worst], p.status, created, courierID, p.rate, p.cheer, p.msg, p.msgLang, p.translated, p.cancelReason); err != nil {
			return err
		}
	}
	// Courier counters reflect the history above (performance page reads them).
	for _, c := range couriers {
		var n int
		_ = s.db.QueryRow(ctx, `SELECT count(*) FROM deliveries WHERE courier_id=$1 AND status='delivered'`, c.uid).Scan(&n)
		if n > 0 {
			_, _ = s.db.Exec(ctx, `UPDATE couriers SET deliveries_count=deliveries_count+$2,
				lifetime_distance_m=lifetime_distance_m+($2*1800),
				lifetime_moving_s=lifetime_moving_s+($2*620),
				lifetime_active_s=lifetime_active_s+($2*700),
				last_delivery_at=GREATEST(COALESCE(last_delivery_at,now()-interval '30 days'),now()-interval '2 hours'),
				updated_at=now() WHERE user_id=$1`, c.uid, n)
		}
	}
	// Two mock withdrawals so the CMS payouts monitor has live rows.
	if len(couriers) > 0 {
		top := couriers[2%len(couriers)]
		_, _ = s.db.Exec(ctx, `INSERT INTO withdrawals(courier_id,amount_minor,currency,status,debited,payout_ref,idempotency_key)
			VALUES($1,85000,'IDR','paid',true,'MOCK-PAY-GBK-001','gbk-seed-wd-1')
			ON CONFLICT (courier_id,idempotency_key) DO NOTHING`, top.uid)
		second := couriers[5%len(couriers)]
		_, _ = s.db.Exec(ctx, `INSERT INTO withdrawals(courier_id,amount_minor,currency,status,debited,idempotency_key)
			VALUES($1,62000,'IDR','processing',true,'gbk-seed-wd-2')
			ON CONFLICT (courier_id,idempotency_key) DO NOTHING`, second.uid)
	}
	return nil
}

// insertGBKOrder writes one order + items + lifecycle events + delivery +
// offers + ledger postings in a single transaction, mirroring createOrder,
// acceptOrder, readyOrder, pickup/delivered transitions and their money legs.
// timing is the merchant's accept promise (prep + delivery window).
func (s *Server) insertGBKOrder(ctx context.Context, idem, code, pin, pickup string,
	cu gbkCustomer, merchantID string, timing acceptTiming, pick []gbkMenuItem, qtys []int, q order.Quote,
	sizeClass, status string, created time.Time, courierID *string,
	stars int, cheer, msg, msgLang, translated, cancelReason string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()
	payStatus := "held"
	placedAt := created
	var acceptedAt, readyAt, deliveredAt, cancelledAt any
	chain := []string{"awaiting_payment", "placed"}
	switch status {
	case "placed":
	case "accepted":
		chain = append(chain, "accepted")
		acceptedAt = created.Add(4 * time.Minute)
	case "ready":
		chain = append(chain, "accepted", "ready")
		acceptedAt = created.Add(3 * time.Minute)
		readyAt = created.Add(12 * time.Minute)
	case "picked_up":
		chain = append(chain, "accepted", "ready", "picked_up")
		acceptedAt = created.Add(3 * time.Minute)
		readyAt = created.Add(11 * time.Minute)
	case "delivered", "completed":
		chain = append(chain, "accepted", "ready", "picked_up", "delivered")
		acceptedAt = created.Add(3 * time.Minute)
		readyAt = created.Add(11 * time.Minute)
		deliveredAt = created.Add(28 * time.Minute)
		if status == "completed" {
			chain = append(chain, "completed")
		}
	case "cancelled":
		chain = append(chain, "cancelled")
		cancelledAt = created.Add(6 * time.Minute)
	}
	// Accepted-or-later orders carry the accept promise, exactly as the live
	// acceptOrder writes it; placed/cancelled-before-accept orders have none.
	var readyEst, winStart, winEnd any
	if at, ok := acceptedAt.(time.Time); ok {
		readyEst, winStart, winEnd = timing.at(at)
	}
	var orderID string
	err = tx.QueryRow(ctx, `INSERT INTO orders(code,customer_id,merchant_id,status,currency,
		subtotal_minor,delivery_fee_minor,service_fee_minor,tip_minor,total_minor,
		commission_minor,courier_fee_minor,size_class,payment_method,payment_status,
		dropoff,dropoff_note,dropoff_pin,prep_minutes,placed_at,accepted_at,ready_at,delivered_at,cancelled_at,
		cancel_reason,idempotency_key,created_at,updated_at,ready_at_est,window_start,window_end)
		VALUES($1,$2,$3,$4,'IDR',$5,$6,$7,$8,$9,$10,$11,$12,'wallet',$13,
		ST_SetSRID(ST_MakePoint($14,$15),4326)::geography,$16,$17,$26,$18,$19,$20,$21,$22,$23,$24,$25,$25,$27,$28,$29)
		ON CONFLICT (customer_id,idempotency_key) DO NOTHING
		RETURNING id`,
		code, cu.uid, merchantID, status,
		q.SubtotalMinor, q.DeliveryMinor, q.ServiceMinor, q.TipMinor, q.TotalMinor,
		q.CommissionMinor, q.CourierFeeMinor, sizeClass, payStatus,
		cu.lng, cu.lat, cu.rm, pin,
		placedAt, acceptedAt, readyAt, deliveredAt, cancelledAt,
		cancelReason, idem, created, timing.PrepMin, readyEst, winStart, winEnd).Scan(&orderID)
	if err != nil {
		return err
	}
	if orderID == "" {
		// Already seeded (idempotency guard hit): nothing more to do.
		_ = tx.Rollback(ctx)
		committed = true
		return nil
	}
	for j, it := range pick {
		if _, err := tx.Exec(ctx, `INSERT INTO order_items(order_id,menu_item_id,name_snapshot,unit_price_minor,qty)
			VALUES($1,$2,$3,$4,$5)`, orderID, it.id, it.name, it.price, qtys[j]); err != nil {
			return err
		}
	}
	for k := 1; k < len(chain); k++ {
		actor := "customer"
		if chain[k] == "accepted" || chain[k] == "ready" {
			actor = "merchant"
		} else if chain[k] == "picked_up" || chain[k] == "delivered" || chain[k] == "completed" {
			actor = "courier"
		}
		if chain[k] == "cancelled" {
			actor = "customer"
			if cancelReason == "merchant rejected: sold out" {
				actor = "merchant"
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO order_events(order_id,from_status,to_status,actor_type,actor_id,reason)
			VALUES($1,$2,$3,$4,$5,'gbk seed')`, orderID, chain[k-1], chain[k], actor, cu.uid); err != nil {
			return err
		}
	}
	// Money legs: wallet charge held in escrow; refund on cancel; settlement
	// to merchant + courier + platform on delivered/completed.
	if err := postEntry(ctx, tx, "order_charge", ledger.ChargeKey(orderID), "order", orderID,
		ledger.ChargePostings(q, cu.uid, orderID)); err != nil {
		return err
	}
	if status == "cancelled" {
		if err := postEntry(ctx, tx, "order_refund", ledger.RefundKey(orderID), "order", orderID,
			ledger.RefundPostings(q, cu.uid, orderID)); err != nil {
			return err
		}
	}
	// No delivery row for placed orders: like the live lifecycle, the
	// delivery (and its courier search) only starts at merchant accept.
	var deliveryID string
	if deliveryStatus, ok := gbkSeedDeliveryStatus(status); ok {
		var dCourier any
		if courierID != nil && status != "cancelled" {
			dCourier = *courierID
		}
		err = tx.QueryRow(ctx, `INSERT INTO deliveries(order_id,type,status,courier_id,pickup_code,dropoff_pin,
			trip_m,to_pickup_m,carried_distance_m,carried_active_s,eta_s,
			assigned_at,picked_up_at,delivered_at,search_started_at,cancel_note,created_at)
			VALUES($1,'workout',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
			orderID, deliveryStatus, dCourier, pickup, pin,
			1200.0, 620.0, 1400.0, 640, 1500,
			nullableTime(acceptedAt), nullableTime(deliveredAtFor(status, created, true)), nullableTime(deliveredAtFor(status, created, false)),
			created, cancelReasonFor(status, cancelReason), created).Scan(&deliveryID)
		if err != nil {
			return err
		}
	}
	if courierID != nil && (status == "delivered" || status == "completed") {
		if err := postEntry(ctx, tx, "order_settle", ledger.SettleKey(orderID), "order", orderID,
			ledger.SettlementPostings(q, orderID, merchantID, *courierID)); err != nil {
			return err
		}
	}
	if courierID != nil && deliveryID != "" && status != "cancelled" {
		// Accepted offer for the assigned courier + decoy offers so the
		// acceptance-rate metric reads like real dispatch history.
		_, _ = tx.Exec(ctx, `INSERT INTO dispatch_offers(delivery_id,courier_id,rank,kind,status,score,expires_at,responded_at,created_at)
			VALUES($1,$2,0,'directed','accepted',0.92,$3,$3,$3) ON CONFLICT (delivery_id,courier_id) DO NOTHING`,
			deliveryID, *courierID, created.Add(2*time.Minute))
	}
	if status == "delivered" || status == "completed" {
		if stars >= 1 && stars <= 5 {
			tags, _ := json.Marshal([]string{"fast", "friendly"})
			if stars == 4 {
				tags, _ = json.Marshal([]string{"fast"})
			}
			topics, _ := json.Marshal([]string{"delivery_speed"})
			rStars := int16(stars)
			mStars := int16(5)
			if stars == 4 {
				mStars = 4
			}
			var rc *string
			if courierID != nil {
				rc = courierID
			}
			var rcVal any
			if rc != nil {
				rcVal = *rc
			}
			_, _ = tx.Exec(ctx, `INSERT INTO order_ratings(order_id,customer_id,courier_id,courier_stars,courier_tags,restaurant_stars,topics)
				VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (order_id) DO NOTHING`,
				orderID, cu.uid, rcVal, rStars, string(tags), mStars, string(topics))
		}
		if cheer != "" && courierID != nil {
			_, _ = tx.Exec(ctx, `INSERT INTO order_cheers(order_id,customer_id,courier_id,message,created_at)
				VALUES($1,$2,$3,$4,$5)`, orderID, cu.uid, *courierID, cheer, created.Add(40*time.Minute))
		}
	}
	if msg != "" && courierID != nil {
		_, _ = tx.Exec(ctx, `INSERT INTO order_messages(order_id,sender_type,sender_id,body,lang,translated_body,moderated,created_at)
			VALUES($1,'customer',$2,$3,$4,$5,true,$6)`,
			orderID, cu.uid, msg, msgLang, translated, created.Add(6*time.Minute))
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	committed = true
	return nil
}

// gbkSeedDeliveryStatus maps a seeded order status to its delivery row
// status. ok=false means the order has no delivery yet: the live lifecycle
// creates it only at merchant accept, so a seeded placed order must not
// carry a stale 'searching' row (that would draw phantom staff offers and
// "No courier found" pushes whenever a courier posts GPS nearby).
func gbkSeedDeliveryStatus(orderStatus string) (deliveryStatus string, ok bool) {
	switch orderStatus {
	case "accepted", "ready":
		return DeliveryAssigned, true
	case "picked_up":
		return DeliveryPickedUp, true
	case "delivered", "completed":
		return DeliveryDelivered, true
	case "cancelled":
		return DeliveryCancelled, true
	default:
		return "", false
	}
}

func nullableTime(v any) any { return v }

func deliveredAtFor(status string, created time.Time, pickup bool) any {
	switch status {
	case "picked_up":
		if pickup {
			return created.Add(20 * time.Minute)
		}
		return nil
	case "delivered", "completed":
		if pickup {
			return created.Add(20 * time.Minute)
		}
		return created.Add(28 * time.Minute)
	case "accepted", "ready":
		return nil
	default:
		return nil
	}
}

func cancelReasonFor(status, reason string) string {
	if status == "cancelled" {
		return reason
	}
	return ""
}

// ---------- AI extras ----------

// seedGBKAIExtras gives the three AI surfaces something honest to show:
// a Snap-a-Menu import awaiting merchant review, advisory Trust Briefs for
// two couriers, proof checks on two delivered legs, and fallback-marked
// ai_calls rows so the CMS AI page shows the fallback badge truthfully.
func (s *Server) seedGBKAIExtras(ctx context.Context, merchants []gbkMerchant, couriers []gbkCourier) error {
	if len(merchants) == 0 || len(couriers) == 0 {
		return nil
	}
	drafts, _ := json.Marshal([]map[string]any{
		{"name": map[string]string{"en": "Grilled Chicken Rice Box", "id": "Nasi Ayam Panggang"}, "price_minor": nil, "size_class": "M"},
		{"name": map[string]string{"en": "Iced Tea", "id": "Es Teh Manis"}, "price_minor": nil, "size_class": "S"},
		{"name": map[string]string{"en": "Beef Satay", "id": "Sate Sapi"}, "price_minor": nil, "size_class": "M"},
	})
	_, _ = s.db.Exec(ctx, `INSERT INTO menu_import_jobs(merchant_id,status,progress,drafts,prices_checked)
		SELECT $1,'needs_review',100,$2,false
		WHERE NOT EXISTS (SELECT 1 FROM menu_import_jobs WHERE merchant_id=$1 AND status='needs_review')`,
		merchants[0].mid, string(drafts))
	for i, c := range couriers[:min(2, len(couriers))] {
		var appID *string
		var aid string
		_ = s.db.QueryRow(ctx, `SELECT id FROM courier_applications WHERE user_id=$1`, c.uid).Scan(&aid)
		if aid != "" {
			appID = &aid
		}
		risk := "low"
		summary := "Consistent fitness record, verified ID, no sanctions. Advisory only — human decides."
		if i == 1 {
			risk = "medium"
			summary = "New account with limited history; documents verified. Advisory only — human decides."
		}
		reasons, _ := json.Marshal([]string{"ID verified", "fitness passed within limits", "no prior sanctions"})
		var appVal any
		if appID != nil {
			appVal = *appID
		}
		_, _ = s.db.Exec(ctx, `INSERT INTO trust_briefs(user_id,application_id,risk,summary,reasons,photo_note,fallback)
			VALUES($1,$2,$3,$4,$5,'Checkpoint photo clear, matches selfie.',true)
			ON CONFLICT (user_id) DO NOTHING`, c.uid, appVal, risk, summary, string(reasons))
	}
	// Proof checks on two delivered legs.
	rows, err := s.db.Query(ctx, `SELECT d.id FROM deliveries d JOIN orders o ON o.id=d.order_id
		WHERE d.status='delivered' AND o.idempotency_key LIKE 'gbk-seed-%' ORDER BY o.created_at LIMIT 2`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var did string
			if err := rows.Scan(&did); err != nil {
				continue
			}
			_, _ = s.db.Exec(ctx, `INSERT INTO proof_checks(delivery_id,verdict,note,fallback)
				SELECT $1,'ok','Handoff photo shows sealed bag, matches order. Seed fallback check — human review for anything unclear.',true
				WHERE NOT EXISTS (SELECT 1 FROM proof_checks WHERE delivery_id=$1)`, did)
		}
	}
	for _, f := range []struct{ feature, model string }{
		{"menu_import", "seed-fallback"},
		{"trust_brief", "seed-fallback"},
		{"translate", "seed-fallback"},
		{"coach_weekly", "seed-fallback"},
		{"proof_check", "seed-fallback"},
		{"copilot", "seed-fallback"},
	} {
		_, _ = s.db.Exec(ctx, `INSERT INTO ai_calls(feature,model,prompt_version,latency_ms,
			input_tokens,output_tokens,cost_micros,fallback,error)
			VALUES($1,$2,'gbk-seed-v1',0,0,0,0,true,'seed fallback row — no live model call')`, f.feature, f.model)
	}
	return nil
}
