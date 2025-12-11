const { Client } = require('pg');

const client = new Client({
  connectionString: "postgresql://tradingbot:secure_password_2024@127.0.0.1:5437/tradingbot_glicko",
});

client.connect()
  .then(() => {
    console.log('Connected successfully');
    return client.end();
  })
  .catch(err => {
    console.error('Connection error', err.stack);
    return client.end();
  });
