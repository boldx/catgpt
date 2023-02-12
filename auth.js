require('dotenv/config');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const url = require('url');


const oauth_api = axios.create({
  baseURL: 'https://zoom.us/oauth',
  auth: {
    username: process.env.clientID,
    password: process.env.clientSecret
  },
});


const app = express();
app.use(bodyParser.json());


app.get('/', (req, res) => {
    res.send('Meow!');
})


app.get('/auth', async (req, res) => {
    if(!req.query.code) {
        res.redirect(url.format({pathname:"/authorize", query: {response_type: 'code', client_id: process.env.clientID, redirect_uri: process.env.redirectURL}}));
    } else {
        const params = new url.URLSearchParams({grant_type: 'authorization_code', code: req.query.code, redirect_uri: process.env.redirectURL});
        try {
            let resp = await oauth_api.post('/token', params.toString());
            fs.writeFileSync(process.env.refreshTokenFile, resp.data.refresh_token);
        } catch (error) { 
            console.error(`Acquiring initial tokens failed: ${error} ${JSON.stringify(error.response?.data)}`);
        };
        res.redirect('/');
    }
})


app.listen(4000, () => {
    console.log(`App listening at :4000`);
})
