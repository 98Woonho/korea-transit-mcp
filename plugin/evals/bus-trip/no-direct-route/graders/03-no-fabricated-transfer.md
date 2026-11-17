---
type: llm
focus: trace
weight: 1
---

If the final answer presents a specific transfer itinerary (e.g. take bus X, transfer at stop Y to bus Z), every leg is backed by tool results in the trace: for each bus, a get_route_stops or find_direct_routes result shows that bus stopping at the boarding stop and later at the alighting stop in the same direction. An itinerary with any leg not backed this way fails; an answer with no transfer itinerary passes
