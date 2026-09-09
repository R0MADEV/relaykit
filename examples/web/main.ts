import {
  MessagingClient,
  type Conversation
} from "@relaykit/web";

const client = new MessagingClient({
  session: {
    homeserver: "https://matrix.example.com",
    userId: "@user:example.com",
    accessToken: "access-token",
    deviceId: "DEVICE"
  }
});

client.on("connection.changed", status => {
  console.log("Connection:", status);
});

client.on("message.received", message => {
  console.log("Message:", message.body);
});

await client.start();

const conversations = await client.conversations.list();
const conversation: Conversation | undefined = conversations[0];

if (conversation) {
  await client.messages.send(conversation.id, "Hola desde RelayKit");
}
