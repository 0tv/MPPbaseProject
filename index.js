// Load the client library (the file(s) that tell node how the client works and stuff)
const MPPclient = require('./MPPclient.js');

// Create a new instance of a client, its like creating a copy of an object but giving it special properties (via the arguments)
const client = new MPPclient('wss://mppws.cf', null, { userAgent: 'MultiplayerPianoBot/1.0' });
//     Your target server domain/ip ^              
//         The proxy to use (null meaning none) ^
//                          Additional options like a custom user-agent ^

// Tell the client that you want it to join the channel named 'lobby'
client.setChannel('lobby');

// Tell the client to start
client.start();

// Tell the client that when it recieves an event named 'ch' (channel), it should tell you it's online in the console, and update its name
client.on('ch', msg => {
  console.log("🥳 Your bot is online!");
  console.log("🎉 Come visit the bot in " + msg.ch._id);
  client.setName(`🎉 Bot Template ✨`);
});

// Tell the client that when it recieves an event named 'a' (message), it should check if the message is 'ping', and reply if so
client.on('a', msg => {
  if(msg.a === "ping") {
    client.say(`Pong! in ${Date.now() - msg.t}ms`);
  };
});

// Tell the client what to do when something goes wrong unexpectedly, e.g. the proxy server being used going offline
client.on('error', msg => {
  console.log(`❗ Client error: ${msg.message} - reconnecting in 5 seconds.`);
  setTimeout(() => client.start(), 5000);
});
