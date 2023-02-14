require('dotenv/config');
const fs = require('fs');
const url = require('url');
const axios = require('axios');
const FormData = require('form-data');


const DEBUG = process.env.DEBUG;


const catApi = axios.create({
  baseURL: 'https://cataas.com/'
});


const chatApi = axios.create({
  baseURL: 'https://api.zoom.us/v2/chat'
});


const oauthApi = axios.create({
  baseURL: 'https://zoom.us/oauth',
  auth: {
    username: process.env.clientID,
    password: process.env.clientSecret
  },
});


async function refreshTokens() {
    let refreshToken = fs.readFileSync(process.env.refreshTokenFile, {encoding:'utf8'}).trim();
    if (!refreshToken) {
        console.error('Refresh token not available. Aborting');
        return;
    }
    const params = new url.URLSearchParams({grant_type: 'refresh_token', refresh_token: refreshToken});
    try {
        let resp = await oauthApi.post('/token', params.toString());
        storeTokens(resp.data)
    } catch (error) {
        console.error(`Refresh token request failed: ${error} ${JSON.stringify(error.response?.data)}`);
    };
}


function storeTokens(body) {
    if (body.access_token) {
        chatApi.defaults.headers.common['Authorization'] = `Bearer ${body.access_token}`;
        console.log('access token was updated');
    }
    if (body.refresh_token) {
        fs.writeFileSync(process.env.refreshTokenFile, body.refresh_token);
        console.log('refresh token was updated');
    }
}


function generateText(triggerWordCount) {
    let stat = {
        'meow': {'meow': 0.5, 'nyaa': 0.25, 'purr': 0.2, 'hiss': 0.05},
        'nyaa': {'meow': 0.5, 'nyaa': 0.4, 'purr': 0.1},
        'purr': {'meow': 0.2, 'nyaa': 0.5, 'purr': 0.3},
        'hiss': {'meow': 0.5, 'nyaa': 0.25, 'purr': 0.25},
    };
    
    function choose(haystack) {
        var prob = Math.random();
        for (const [key, value] of Object.entries(haystack)) {
            prob -= value;
            if (prob <= 0) {
                return key;
            }
        }
    }
    
    let reply = '';
    let nSentences =  1 + Math.floor(Math.random() * triggerWordCount / 5);
    for (let i = 0; i < nSentences; i++) {
        let nWords =  1 + Math.floor(Math.random() * triggerWordCount * 2);
        let prevWord = choose(stat['meow']);
        for (let j = 0; j < nWords; j++) {
            let currentWord = choose(stat[prevWord]);
            if (j == 0) {
                reply += currentWord.charAt(0).toUpperCase() + currentWord.slice(1)
            } else {
                reply += ' ' + currentWord;
            }
            prevWord = currentWord;
        }
        reply += '. '
    }
    
    return reply;
}


async function postFileToChannel(channelId, fileBuffer, fileName) {
    var form = new FormData();
    form.append('to_channel', channelId)
    form.append('files', fileBuffer, fileName)
    return chatApi.post('https://file.zoom.us/v2/chat/users/me/messages/files', form, {
        beforeRedirect: (opts, res) => {
            opts.headers = {
                ...opts.headers,
              // "The caller must retain the authorization header when redirected to a different hostname." ;w;
              "Authorization": chatApi.defaults.headers.common['Authorization'],
            }
        }
    })
}


function toProperIsoString(date) {
    return date.toISOString().substring(0, 19) + 'Z';
}


function toHoursAndMinutes(date) {
    return date.toTimeString().slice(0, 5);
}


function isWorkday(date) {
    return DEBUG || (date.getDay() > 0 && date.getDay() < 6);
} 


function isWorkingHours(date) {
    return date.getHours() >= parseInt(process.env.openingHour) && date.getHours() < parseInt(process.env.closingHour);
}


class CatGPT {
    // *meow at 13:37
    // *put random cat emoji to random message
    // [meow, purr, miau, nyaa] back for [meow, purr, miau, nyaa, ps, cic, pat, pet, cat emoji] but eventually hiss back
    // *post a cat picture daily at a random time
    // *answer for mention with an approximately similar long text, unless not
    
    constructor(minPollingPeriod, pollingThrottleRatio, channelId, ownSender, dailyAnnouncementTime) {
        this._ownSender = ownSender;
        this._channelId = channelId;
        this._dailyAnnouncementTime = dailyAnnouncementTime;
        this._lastSamplingDate = undefined;
        this._lastThrottledSamplingDate = undefined;
        this._lastConversationMainMessageId = 'fake';
        this._hadDailyAnnouncement = false;
        this._pollCounter = 0
        this._pollingThrottleRatio = pollingThrottleRatio;
        this._throttledPollThreshold = Math.floor(1 / pollingThrottleRatio);
        this._unexcitingPollCounter = 0;
        setInterval(() => this._handler(), minPollingPeriod);
    }
    
    async _handler() {
        let currentTime = new Date();
        //console.log('tick', this._pollCounter, this._throttledPollThreshold, isWorkingHours(currentTime))
        await this._fastHandler(currentTime, this._lastSamplingDate);
        this._lastSamplingDate = currentTime;
        // The cat sometimes takes a nap... and there is a rate limit on the Zoom Chat
        if (isWorkingHours(currentTime) && this._pollCounter++ >= this._throttledPollThreshold) {  
            this._pollCounter = 0
            if (await this._throttledHandler(currentTime, this._lastThrottledSamplingDate || currentTime)) {
                this._throttledPollThreshold = 0;
                this._unexcitingPollCounter = 0;
            } else {
                if (this._unexcitingPollCounter++ > 10) {
                    this._throttledPollThreshold = Math.floor(1 / this._pollingThrottleRatio);
                }
            }
            this._lastThrottledSamplingDate = currentTime;
        }   
    }
    
    async _fastHandler(currentTime, lastSamplingDate) {
        if (isWorkday(currentTime) && toHoursAndMinutes(currentTime) == this._dailyAnnouncementTime) {
            if (!this._hadDailyAnnouncement) {
                console.log('Doing the daily anouncement');
                try {
                    if (Math.random() > 0.5) {
                        await chatApi.post('/users/me/messages', { to_channel: this._channelId, message: "Meow!"})
                    } else {
                        let resp = await catApi.get('/cat', {responseType: 'arraybuffer'});
                        let fn = 'cat.' + resp.headers['content-type'].split('/')[1];  // Hint for Zoom to make a preview picture
                        await postFileToChannel(this._channelId, resp.data, fn);
                    }
                    this._hadDailyAnnouncement = true;
                } catch (error) {
                    console.error(`Posting daily announcement failed: ${JSON.stringify(error?.response?.data)}`);
                }
            }
        } else {
            this._hadDailyAnnouncement = false;
        }
    }
    
    async _throttledHandler(currentTime, lastSamplingDate) {
        let excited = false;
        console.log('Checking the messages');
        let messages = [];
        try {
            // U have to poll, b/c (at the time of writing) the webhook events are worthless
            let resp = await chatApi.get('/users/me/messages', {params: { to_channel: this._channelId, from: toProperIsoString(lastSamplingDate)}});
            messages = resp.data.messages;
        } catch (error) { 
            console.error(`Reading messages failed: ${JSON.stringify(error.response?.data)}`);
        };
        
        for (const message of messages) {
            if (message.sender == this._ownSender) {
                continue;  // don't interact with own messages
            }
            
            if (DEBUG) console.log(message);
            
            if (Math.random() > 0.9 && message.reply_main_message_id != this._lastConversationMainMessageId) {
                try {
                    await chatApi.patch(`/users/me/messages/${message.id}/emoji_reactions`, { to_channel: this._channelId, action: 'add', emoji: 'U+1F431'}) // 🐱
                } catch (error) { 
                    console.error(`Posting emoji failed: ${JSON.stringify(error.response?.data)}`);
                };    
            }
            
            if (message.message.includes('@CatGPT') || message.reply_main_message_id == this._lastConversationMainMessageId) {
                excited = true;
                this._lastConversationMainMessageId = message.reply_main_message_id || message.id;
                let triggerWordCount = message.message.split(' ').length
                try {
                    await chatApi.post(
                        '/users/me/messages', 
                        {to_channel: this._channelId, reply_main_message_id: this._lastConversationMainMessageId, message: generateText(triggerWordCount)}
                    )
                } catch (error) { 
                    console.error(`Posting message failed: ${JSON.stringify(error.response?.data)}`);
                };
            }
        }

        return excited;
    }
}


async function logChannels() {
    let resp = await chatApi.get('/users/me/channels');
    console.log(resp.data);
}


function logEnv() {
    for (let varName of ['channelId', 'refreshTokenFile', 'ownSender', 'openingHour', 'closingHour', 'minPollingPeriod', 'pollingThrottleRatio', 'dailyAnnouncementTime']) {
        console.log(varName, process.env[varName])
    }
}


async function main() {
    logEnv();
    await refreshTokens();
    setInterval(refreshTokens, 3600 * 1000 * 0.45);
    logChannels();
    new CatGPT(parseInt(process.env.minPollingPeriod) * 1000, parseFloat(process.env.pollingThrottleRatio), process.env.channelId, process.env.ownSender, process.env.dailyAnnouncementTime)
}


main()
