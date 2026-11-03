package app

import "fmt"

// courierKind is how the kitchen and the customer should see whoever accepted
// a delivery: the restaurant's own staff (staff-mode deliveries — staff log in
// as on-foot couriers, so their courier mode says "runner"), else the
// courier's mode (runner | biker).
func courierKind(deliveryType, mode string) string {
	if deliveryType == "staff" || mode == "" {
		return "staff"
	}
	return mode
}

// assignedPushCopy is the customer's "someone is coming" push for each kind.
func assignedPushCopy(kind string) (title, body string) {
	switch kind {
	case "staff":
		return "Restaurant staff on the way", "The restaurant's own team is bringing your order — follow them live on the map."
	case "biker":
		return "Biker assigned", "Your order has a courier — follow them live on the map."
	default:
		return "Runner assigned", "Your order has a courier — follow them live on the map."
	}
}

// deliveredCopy is the customer's "delivered" push + receipt line. Only a
// workout delivery powered someone's run or ride; the restaurant's own staff
// delivering is not a workout, so its copy says who brought the food.
func deliveredCopy(deliveryType, code string, carriedM float64, activeS int64) (title, body, email string) {
	if deliveryType == "staff" {
		return "Delivered — thank you!",
			"Delivered by the restaurant's own team. Enjoy your meal!",
			fmt.Sprintf("Order %s delivered by the restaurant's own team.", code)
	}
	return "Delivered — thank you!",
		fmt.Sprintf("You powered %.1f km of your courier's workout.", carriedM/1000),
		fmt.Sprintf("Order %s delivered. You powered %.1f km and %d active minutes.", code, carriedM/1000, activeS/60)
}
