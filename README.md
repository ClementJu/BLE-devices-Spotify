# BLE devices & Spotify

## Demonstration
https://youtu.be/gWMGsb5V7BQ


## General
Supported Bluetooth devices: 
* Nordic Thingy:52
* Magic Blue light bulb


## Files


* Server:
	* ./index.js


* Login page & main page once connected with a Spotify account
	* ./public/index.html


* Page when connected to an existing session (Party Mode)
	* ./views/party.ejs


## Run

1. Choose the right directory using *cd* in your Terminal App
2. Install dependencies
3. *node index.js*
4. Google Chrome (required because of the Bluetooth functionalities) -> localhost:8888

***Be careful***

You will need a client_id and a client_secret in order to run the app and use it. 

Please check the following page for more detail: [https://developer.spotify.com/documentation/web-api/quick-start/](https://developer.spotify.com/documentation/web-api/quick-start/)

Once you have them, replace the "xxx" in ./index.js (lines 10 and 11). 
