var express = require('express'); // Express web server framework
var request = require('request'); // "Request" library
var cors = require('cors');
var querystring = require('querystring');
var cookieParser = require('cookie-parser');
var redis = require("redis");
var io = require("socket.io");
var server = io.listen(7777);

var client_id = 'xxx'; // Your client id
var client_secret = 'xxx'; // Your secret
var redirect_uri = 'http://localhost:8888/callback'; // Your redirect uri

var sessionTokens = [];

// generates a random string
var generateRandomString = function(length) {
  var text = '';
  var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (var i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

// generates a random party token
function generateSessionToken(length){
  var str = "";
  for (let i = 0; i < length; i++){
    str += Math.floor(Math.random() * 10).toString(10);
  }
  return ((str.charAt(0)=='0') ? "B" + str.slice(1, length) : str);
}


var stateKey = 'spotify_auth_state';

var app = express();

var path = require('path');

app.use(express.static(path.join(__dirname + '/public')))
   .use(express.static(path.join(__dirname + '/views')))
   .use(cors())
   .use(cookieParser());

// login
app.get('/login', function(req, res) {

  var state = generateRandomString(16);
  res.cookie(stateKey, state);

  // autorisations nécessaires pour l'utilisation des fonctionnalités de l'API Spotify
  // the app need permission from the user to interact with his Spotify account
  var scope = 'user-read-private user-read-email user-modify-playback-state user-library-read user-read-currently-playing user-read-playback-state'
              + ' streaming user-read-birthdate user-read-email user-read-private user-library-modify';
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      scope: scope,
      redirect_uri: redirect_uri,
      state: state
    }));
});

// OAuth 2.0
app.get('/callback', function(req, res) {

  // your application requests refresh and access tokens
  // after checking the state parameter

  var code = req.query.code || null;
  var state = req.query.state || null;
  var storedState = req.cookies ? req.cookies[stateKey] : null;

  if (state === null || state !== storedState) {
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_mismatch'
      }));
  } else {
    res.clearCookie(stateKey);
    var authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        redirect_uri: redirect_uri,
        grant_type: 'authorization_code'
      },
      headers: {
        'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
      },
      json: true
    };

    request.post(authOptions, function(error, response, body) {
      if (!error && response.statusCode === 200) {

        var access_token = body.access_token,
            refresh_token = body.refresh_token;

        var options = {
          url: 'https://api.spotify.com/v1/me',
          headers: { 'Authorization': 'Bearer ' + access_token },
          json: true
        };

        // use the access token to access the Spotify Web API
        request.get(options, function(error, response, body) {
          console.log(body);
        });

        // we can also pass the token to the browser to make requests from there
        res.redirect('/#' +
          querystring.stringify({
            access_token: access_token,
            refresh_token: refresh_token,
            session_token: generateSessionToken(6)
          }));
      } else {
        res.redirect('/#' +
          querystring.stringify({
            error: 'invalid_token'
          }));
      }
    });
  }
});

// refresh the session token
app.get('/refresh_token', function(req, res) {

  // requesting access token from refresh token
  var refresh_token = req.query.refresh_token;
  var authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    headers: { 'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64')) },
    form: {
      grant_type: 'refresh_token',
      refresh_token: refresh_token
    },
    json: true
  };

  request.post(authOptions, function(error, response, body) {
    if (!error && response.statusCode === 200) {
      var access_token = body.access_token;
      res.send({
        'access_token': access_token
      });
    }
  });
});

// add a user to someone else's party
app.get('/addPartyUser/:token/:name', function(req, res){
  console.log(tokenSocketMain.has(req.params.token));
  console.log(partyModeState.get(req.params.token));
  if(tokenSocketMain.has(req.params.token) && partyModeState.get(tokenSocketMain.get(req.params.token))){
    res.redirect("/party/"+req.params.token+"/"+req.params.name);
  } else {
    res.redirect("/");
  }
});

// displays the party page if someone successfully joined a party
app.get('/party/:token/:name', function(req, res){
  res.render("party.ejs", {session_token: req.params.token, name: req.params.name});
});



var tokenSocketMain = new Map();                        // Map(String token, String socketID)
var sockets = new Map();                                // Map(String socketID, Socket socket)
var partyUsersPerMain = new Map();                      // Map(String socketID d'un utilisateur connecté avec son compte Spotify, Set(String socketID))
var partyModeState = new Map();                         // Map(String SocketID, Boolean partyModeEnabled)
var mainUsers = new Set(), partyUsers = new Set();      // Set(String SocketID), Set(String SocketID)

// websockets
server.on("connection", (socket) => {
    console.info(`Client connected [id=${socket.id}]`);
    sockets.set(socket.id, socket);

    // clients connected with their Spotify account, init
    socket.on("main_session_token", function(data){
      mainUsers.add(socket.id)
      tokenSocketMain.set(data.token.toString(), socket.id);
      partyModeState.set(socket.id, data.state);
      partyUsersPerMain.set(socket.id, new Set());
    });

    // Host -> PartyUser, update current track info
    socket.on("update_party_user", function(data){
      sockets.get(data.socket).emit("update_party_user", {cover: data.cover, name: data.name, artists: data.artists, album: data.album});
    });


    // PartyUser, asks for his host's socketID
    socket.on("request_main_socket", function(data){
      socket.emit("main_socket", {socket: tokenSocketMain.get(data.toString())});
    });

    // PartyUser -> Host, add a new party user
    socket.on("addPartyUser", function(data){

      partyUsers.add(socket.id);

      // link the partyuser to his host
      var users = partyUsersPerMain.get(data.socket);
      users.add(socket.id);
      partyUsersPerMain.set(data.socket, users);

      // notify the host
      sockets.get(data.socket).emit("addPartyUser", {name: data.name, socket: socket.id});
    });

    // PartyUser -> Host, handle a downvote
    socket.on("vote_down", function(data){
      if(partyModeState.get(data.socket)){
        sockets.get(data.socket).emit("vote_down", {name: data.name, socket: socket.id});
      }
      else{
        socket.emit("party_mode_disabled");
      }
    });

    // PartyUser -> Host, handle an upvote
    socket.on("vote_up", function(data){
      console.log(partyModeState.get(data.socket));
      console.log(partyModeState);
      if(partyModeState.get(data.socket)){
        sockets.get(data.socket).emit("vote_up", {name: data.name, socket: socket.id});
      }
      else{
        socket.emit("party_mode_disabled");
      }
    });

    // Host -> Server, party mode enabled/disabled
    socket.on("party_mode_change", function(data){
      partyModeState.set(socket.id, data.state);
    });


    // handle disconnections
    socket.on("disconnect", () => {
        console.info(`Client gone [id=${socket.id}]`);
        // if host (=> in mainUsers)
        if(mainUsers.has(socket.id)){
          // notify the respective party users
          let users = partyUsersPerMain.get(socket.id);
          users.forEach((value, key, set) => {
            sockets.get(value).emit("main_user_disconnected");
          });

          // delete the host
          mainUsers.delete(socket.id);
          partyModeState.delete(socket.id);
          partyUsersPerMain.delete(socket.id);

          var k;
          tokenSocketMain.forEach((value, key, set) => {
            if(value == socket.id){k = key;}
          });
          tokenSocketMain.delete(k);
          sockets.delete(socket.id);
        }

        // if party user, same idea
        else if(partyUsers.has(socket.id)){
          var k, v, mainDisconnected = true;
          partyUsersPerMain.forEach((value, key, set) => {
            if(value != undefined && value.has(socket.id)){
              k = key;
              v = partyUsersPerMain.get(key);
              v.delete(socket.id);
              mainDisconnected = false;
            }
          });
          partyUsersPerMain.set(k, v);

          // notify the host
          if(!mainDisconnected){
            sockets.get(k).emit("party_user_disconnected", {socket: socket.id});
          }

          partyUsers.delete(socket.id);
          sockets.delete(socket.id);
        }
    });
});


console.log('Listening on 8888');
app.listen(8888);
