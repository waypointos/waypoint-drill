test:
	go test ./...

# Needs a dev rover in another terminal: cd ../waypoint && make dev-rover
dev:
	WAYPOINT_NATS_URL=nats://127.0.0.1:4222 \
	WAYPOINT_ROVER_ID=sim-rover \
	WAYPOINT_MODULE_ID=drill \
	WAYPOINT_MODULE_COMPONENT=drill \
	WAYPOINT_MODULE_STATE_RATE_HZ=20 \
	go run ./cmd/waypoint-module-drill

raw:
	$(MAKE) -f build/Makefile raw
