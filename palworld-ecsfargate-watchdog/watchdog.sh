#!/bin/bash

## Required Environment Variables

[ -n "$CLUSTER" ] || { echo "CLUSTER env variable must be set to the name of the ECS cluster" ; exit 1; }
[ -n "$SERVICE" ] || { echo "SERVICE env variable must be set to the name of the service in the $CLUSTER cluster" ; exit 1; }
[ -n "$SERVERNAME" ] || { echo "SERVERNAME env variable must be set to the full A record in Route53 we are updating" ; exit 1; }
[ -n "$DNSZONE" ] || { echo "DNSZONE env variable must be set to the Route53 Hosted Zone ID" ; exit 1; }
[ -n "$STARTUPMIN" ] || { echo "STARTUPMIN env variable not set, defaulting to a 10 minute startup wait" ; STARTUPMIN=10; }
[ -n "$SHUTDOWNMIN" ] || { echo "SHUTDOWNMIN env variable not set, defaulting to a 20 minute shutdown wait" ; SHUTDOWNMIN=20; }
[ -n "$RCON_PORT" ] || { echo "RCON_PORT env variable must be set to the RCON server port" ; exit 1; }
[ -n "$RCON_PASSWORD" ] || { echo "RCON_PASSWORD env variable must be set" ; exit 1; }

function send_notification ()
{
  [ "$1" = "startup" ] && MESSAGETEXT="Palworld server is online at ${SERVERNAME}" && DISCORDTEXT="{
    \"content\": null,
    \"embeds\": [
      {
        \"title\": \"🟢 Server Started!\",
        \"description\": \"Server IP: \`$SERVERNAME\`\n\n⚠️ The server will be shut down if there is no activity in the next $STARTUPMIN minutes.\n\n👌 If you forget to stop the server after playing, we will shut it down after $SHUTDOWNMIN minutes of the last activity to save up costs.\n\nAll progress will be automatically saved 👍\",
        \"color\": null
      }
    ],
    \"attachments\": []
  }"

  [ "$1" = "shutdown" ] && MESSAGETEXT="Shutting down ${SERVICE} at ${SERVERNAME}" && DISCORDTEXT="{
      \"content\": null,
      \"embeds\": [{
          \"title\": \"🔴 Server stopped\",
          \"description\": \"Hope you had fun and don't forget to touch real grass 🌿\",
          \"color\": null
      }],
      \"attachments\": []
  }"

  ## Twilio Option
  [ -n "$TWILIOFROM" ] && [ -n "$TWILIOTO" ] && [ -n "$TWILIOAID" ] && [ -n "$TWILIOAUTH" ] && \
  echo "Twilio information set, sending $1 message" && \
  curl --silent -XPOST -d "Body=$MESSAGETEXT" -d "From=$TWILIOFROM" -d "To=$TWILIOTO" "https://api.twilio.com/2010-04-01/Accounts/$TWILIOAID/Messages" -u "$TWILIOAID:$TWILIOAUTH"

  ## Discord Option
  IFS=',' read -ra DISCORDWEBHOOKS <<< "$DISCORDWEBHOOKS"
  for DISCORDWEBHOOK in "${DISCORDWEBHOOKS[@]}"; do
    [ -n "$DISCORDWEBHOOK" ] && \
    echo "Discord webhook set, sending $1 message" && \
    curl --silent -X POST -H "Content-Type: application/json" -d "$DISCORDTEXT" "$DISCORDWEBHOOK"
  done

  ## SNS Option
  [ -n "$SNSTOPIC" ] && \
  echo "SNS topic set, sending $1 message" && \
  aws sns publish --topic-arn "$SNSTOPIC" --message "$MESSAGETEXT"
}

function zero_service ()
{
  echo "Initiating shutdown..."
  echo "Sending save command to server..."
  /usr/local/bin/rcon -a $RCON_ADDRESS:$RCON_PORT -p $RCON_PASSWORD "Save"
  sleep 60
  echo "Sending shutdown notification..."
  send_notification shutdown
  echo Setting desired task count to zero.
  aws ecs update-service --cluster $CLUSTER --service $SERVICE --desired-count 0
  exit 0
}

function sigterm ()
{
  ## upon SIGTERM set the service desired count to zero
  echo "Received SIGTERM, terminating task..."
  zero_service
}
trap sigterm SIGTERM

## get task id from the Fargate metadata
TASK=$(curl -s ${ECS_CONTAINER_METADATA_URI_V4}/task | jq -r '.TaskARN' | awk -F/ '{ print $NF }')
echo I believe our task id is $TASK

## get eni from from ECS
ENI=$(aws ecs describe-tasks --cluster $CLUSTER --tasks $TASK --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value | [0]" --output text)
echo I believe our eni is $ENI

## get public ip address from EC2
PUBLICIP=$(aws ec2 describe-network-interfaces --network-interface-ids $ENI --query 'NetworkInterfaces[0].Association.PublicIp' --output text)
echo "I believe our public IP address is $PUBLICIP"

## update public dns record
echo "Updating DNS record for $SERVERNAME to $PUBLICIP"
## prepare json file
cat << EOF >> palworld-dns.json
{
  "Comment": "Fargate Public IP change for Palworld Server",
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "$SERVERNAME",
        "Type": "A",
        "TTL": 30,
        "ResourceRecords": [
          {
            "Value": "$PUBLICIP"
          }
        ]
      }
    }
  ]
}
EOF
aws route53 change-resource-record-sets --hosted-zone-id $DNSZONE --change-batch file://palworld-dns.json

## Check for RCON readiness
echo "Checking for RCON readiness..."
RETRY_COUNT=0
MAX_RETRIES=30 # Maximum number of retries (e.g., 5 minutes with 10-second intervals)
RETRY_INTERVAL=10 # Time in seconds to wait between retries
while ! /usr/local/bin/rcon -a $RCON_ADDRESS:$RCON_PORT -p $RCON_PASSWORD "info"; do
    echo "Failed to connect to RCON. Retrying in $RETRY_INTERVAL seconds..."
    sleep $RETRY_INTERVAL
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "Failed to connect to RCON after $MAX_RETRIES retries. Exiting."
        exit 1
    fi
done

echo "RCON is ready. Proceeding with server monitoring."

## Send startup notification message
send_notification startup

echo "Checking every 1 minute for active players, up to $STARTUPMIN minutes..."
COUNTER=0
while [ $COUNTER -lt $STARTUPMIN ]
do
  # Run the RCON command to show players and count the number of lines
  # Assumes each player is listed on a new line in the RCON output
  echo "Checking for players, minute $COUNTER out of $STARTUPMIN..."
  PLAYER_COUNT=$(/usr/local/bin/rcon -a $PUBLICIP:$RCON_PORT -p $RCON_PASSWORD "ShowPlayers" | wc -l)
  # Subtract 1 from the count to account for the header line in the output
  PLAYER_COUNT=$((PLAYER_COUNT - 1))
  
  if [ $PLAYER_COUNT -gt 0 ]; then
    echo "Detected $PLAYER_COUNT player(s). Resetting startup counter."
    COUNTER=0
  else
    COUNTER=$((COUNTER + 1))
    if [ $COUNTER -ge $STARTUPMIN ]; then
      echo "$STARTUPMIN minutes elapsed without players. Shutting down."
      zero_service
    fi
  fi

  sleep 60
done

echo "Player activity detected, switching to shutdown watcher."
COUNTER=0
while [ $COUNTER -le $SHUTDOWNMIN ]
do
  # Run the RCON command to show players and count the number of lines
  # Assumes each player is listed on a new line in the RCON output
  echo "Checking for players, minute $COUNTER out of $STARTUPMIN..."
  PLAYER_COUNT=$(/usr/local/bin/rcon -a $PUBLICIP:$RCON_PORT -p $RCON_PASSWORD "ShowPlayers" | wc -l)
  # Subtract 1 from the count to account for the header line in the output
  PLAYER_COUNT=$((PLAYER_COUNT - 1))
  
  if [ $PLAYER_COUNT -lt 1 ]; then
    echo "No active players detected, $COUNTER out of $SHUTDOWNMIN minutes..."
    COUNTER=$((COUNTER + 1))
  else
    echo "Detected active players. Resetting shutdown counter."
    COUNTER=0
  fi

  sleep 60
done

echo "$SHUTDOWNMIN minutes elapsed without players. Shutting down."
zero_service