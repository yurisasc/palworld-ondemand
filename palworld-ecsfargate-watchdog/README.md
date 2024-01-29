# Palworld ECS Fargate Watchdog
This document is a work in progress but is meant to document the container, its changes, and testing methods

## Changelog
- 1.0.0 - initial release

## Tests
With any changes, the container needs to be able to do the following without error:
- Automatically shut down after 10 minutes without a connection
- Detect a connection and not shut down
- Detect when all players have disconnected and initiate shutdown timer
- Shut down 20 minutes after last player has disconncted
- Catch SIGTERM and properly shut down

All of these tests should be performed before pushing the `latest` tag.
