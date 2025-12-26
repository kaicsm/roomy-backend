# Roomy

Roomy is a real-time media synchronization service that lets you watch videos or even listen to music together with your friends, no matter where they are. This is the backend API for Roomy.

# Getting Started

You'll need bun and docker installed on your system.

### Clone the repository and install its dependencies:

```sh
git clone https://github.com/kaicsm/roomy-backend
cd roomy-backend
bun install
```

### Set up environment variables:

```sh
cp .env.example .env
```

and edit .env with your own values of each variable.

### Start the infrastructure:

```sh
docker compose up -d
```

### Run database migrations:
```sh
bun db:migrate
```

### Start the server:
```sh
bun dev
```

# How It Works?

Roomy uses websockets and Redis for high-performance real-time communication. To create a new room, the client makes a POST request to the `/rooms` endpoint and receives its ID along with its metadata. With the room ID and metadata, the client can connect to it via websocket using the `/rooms/:roomId/ws` endpoint. The websocket messages that the server receives and sends are defined in the `ws.types.ts` file, highlighting the most important ones:

- `SYNC_REQUEST`: Makes a request for the current state of the room. Server responds with a `SYNC_FULL_STATE` message, containing the current room state. This message should be sent whenever a new user enters a room.

- `UPDATE_PLAYBACK`: Updates the room state with new information. Server sends a `PLAYBACK_UPDATED` message to all users, containing the updated room state. Sent when the user takes an action, such as play/pause/seek, etc.

- `HEARTBEAT`: Keeps the room alive in the server's memory. Rooms are automatically deleted after 1 minute of inactivity; therefore, the client must send this message (preferably every 30 seconds) to prevent the room from being cleared.


# Tech Stack

- `Bun` as the JS runtime
- `Elysia JS` as the web framework
- `PostgreSQL` as the database service (managed with Drizzle ORM)
- `Redis` as the caching service
- `Docker` for containerization
