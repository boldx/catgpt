CatGPT
===

Silly little Zoom chat bot


Build & run
---
Create an OAuth app at https://marketplace.zoom.us/develop/create (Intend to publish: No, User managed app, OAuth app) \
Fill in neccessary info (refer to https://marketplace.zoom.us/docs/guides/build/oauth-app/) \
Set chat_channel:read, chat_message:read, chat_message:write scopes \
Create and fill .env file \
Run auth.js and authorize the app \
Run catgpt.js, note the appropriate channel id, stop catgpt.js \
Edit the value of channelId in the .env file \
Run catgpt.js
```
npm install
cp dotenv.template .env
vim .env
node auth.js
node catgpt.js
vim .env
node catgpt.js
```
