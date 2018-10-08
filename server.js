const API_URL = '/api/';
const SECRET_KEY = '220190';
// Set up
var express = require('express');
var app = express(); // create our app w/ express
var mongoose = require('mongoose'); // mongoose for mongodb
var morgan = require('morgan'); // log requests to the console (express4)
var bodyParser = require('body-parser'); // pull information from HTML POST (express4)
var methodOverride = require('method-override'); // simulate DELETE and PUT (express4)
var cors = require('cors');
var session = require("express-session");
var jwt = require('jsonwebtoken');
var server = app.listen(8080);
var io = require('socket.io').listen(server);
var http = require('http');
var chatRooms = [];

// Configuration
mongoose.connect('mongodb://localhost/chatu');

app.use(morgan('dev')); // log every request to the console
app.use(bodyParser.urlencoded({ 'extended': 'true' })); // parse application/x-www-form-urlencoded
app.use(bodyParser.json()); // parse application/json
app.use(bodyParser.json({ type: 'application/vnd.api+json' })); // parse application/vnd.api+json as json
app.use(methodOverride());
app.use(cors());
app.disable('x-powered-by');
app.use(session({ resave: true, saveUninitialized: true, secret: 'CHATU', cookie: { maxAge: 60000 } }));
//app.use(express.static(__dirname, 'public'));
app.use(express.static(__dirname + '/node_modules'));

app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header('Access-Control-Allow-Methods', 'DELETE, PUT');
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Cache-Control", "no-cache, no-store, must-revalidate");
    res.header("Vary", "Authorization");
    res.header("Pragma", "no-cache");
    res.header("Expires", 0);
    next();
});

// Models
var ChatSchema = new mongoose.Schema({
    roomId: String,
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    contact: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    messages: [{
        authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        created: Date,
        text: String,
        read: Boolean
    }],
    created: Date,
    newMessages: Boolean,
    category: Number
});

const UserSchema = new mongoose.Schema({
    userId: Number,
    username: String,
    password: String,
    name: String,
    lastName: String,
    email: String,
    avatar: String,
    phone: String,
    lastConnection: Date,
    status: Number
});

const TokenSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    token: String,
    expirationDate: Date
})

var Chat = mongoose.model('Chat', ChatSchema);
var User = mongoose.model('User', UserSchema);
var Token = mongoose.model('Token', TokenSchema);

// Routes


app.get('/api/chat', (req, res) => {
    jwt.verify(req.get('authorization'), SECRET_KEY, function(err, token) {
        if (err) res.status(404).send(returnErrorMessage('Token inválido.'))
        else Token.findOne({ token: req.get('authorization') })
            .populate('user')
            .exec((error, tokenDB) => {
                if (error) res.status(400).send(err);
                else if (!tokenDB) res.status(404).send(returnErrorMessage('Token inválido'));
                else
                    Chat.find({ $or: [{ 'creator': tokenDB.user._id }, { 'contact': tokenDB.user._id }] })
                    .populate('creator', ['name', 'lastName', 'avatar', 'lastConnection', 'online', '_id'])
                    .populate('contact', ['name', 'lastName', 'avatar', 'lastConnection', 'online', '_id'])
                    .exec((err, chats) => {
                        if (err) res.status(400).send(err)
                        if (!chats) res.status(400).send(returnErrorMessage('No hay chats disponibles'));
                        res.json(returnSuccessJson(chats));
                    });
            });
    });
});

app.post('/api/chat', function(req, res) {

    jwt.verify(req.get('authorization'), SECRET_KEY, function(err, token) {
        if (err) res.status(404).send(returnErrorMessage('Token inválido.'))
        else Token.findOne({ token: req.get('authorization') })
            .populate('user')
            .exec((error, tokenDB) => {
                if (error) res.status(400).send(err);
                else if (!tokenDB) res.status(404).send(returnErrorMessage('Token inválido'));
                else
                    User.findOne({ 'userId': req.body.contactId })
                    .exec((error, contact) => {
                        if (error) res.status(400).send(err);
                        else if (!contact) res.status(404).send(returnErrorMessage('El contacto con el que intentas hablar no esta registrado.'));
                        else
                            Chat.create({
                                roomId: (+new Date).toString(36).slice(-8).concat(tokenDB.user._id + ':' + contact._id),
                                creator: tokenDB.user._id,
                                contact: contact._id,
                                created: Date.now(),
                                newMessages: false,
                                category: 1,
                                messages: []
                            }, (err, chat) => {
                                if (err) res.status(400).send(err);
                                else if (!chat) res.status(400).send(returnErrorMessage('No se ha podido establecer la conversación.'))
                                else res.json(returnSuccessJson(chat));
                            });
                    });
            });
    });

});

app.get('/api/chat/:id', (req, res) => {
    //if (!isLogged(req.session)) res.status(401).send(returnErrorMessage('Usuario no identificado'));
    Chat.findOne({ 'roomId': req.params.id })
        .populate('creator', ['name', 'lastName', 'avatar', 'lastConnection', 'online', '_id'])
        .populate('contact', ['name', 'lastName', 'avatar', 'lastConnection', 'online', '_id'])
        .exec((err, chat) => {
            if (err) res.status(400).send(err)
            if (!chat) res.status(400).send(returnErrorMessage('No hay chats disponibles'));
            res.json(returnSuccessJson(chat));
        });
});

app.patch('/api/chat/:id/message', function(req, res) {
    //io.to(clientX.id).emit('messageraro', 'whatever');
    jwt.verify(req.get('authorization'), SECRET_KEY, function(err, token) {
        if (err) res.status(404).send(returnErrorMessage('Token inválido.'))
        else Token.findOne({ token: req.get('authorization') })
            .populate('user')
            .exec((error, tokenDB) => {
                if (error) res.status(400).send(err);
                else if (!tokenDB) res.status(404).send(returnErrorMessage('Token inválido'));
                else
                    Chat.update({ roomId: req.params.id }, {
                            $push: {
                                "messages": {
                                    authorId: tokenDB.user._id,
                                    created: Date.now(),
                                    read: false,
                                    text: req.body.text
                                }
                            }
                        }, { safe: true, upsert: true },
                        (err, update) => {
                            if (err) res.status(400).send(err);
                            else if (!update) res.status(404).json(returnErrorMessage('No se ha actualizó el chat!'))
                            else {
                                let room = chatRooms.find((room) => req.params.id === room['roomId']);
                                let clientSearch = room['participants'].find((user) => user['idUser'] != tokenDB.user._id);
                                console.log('El cliente es: ' + JSON.stringify(clientSearch));
                                if (clientSearch.hasOwnProperty('clientId')) {
                                    console.log('Envio el mensaje al cliente');
                                    io.to(clientSearch.clientId).emit('messageraro', clientSearch.idUser + ' te ha enviado un mensaje');
                                }
                                res.json(returnSuccessJson(update));
                            }
                        });
            });
    });
});

app.post('/api/user/create', (req, res) => {
    User.findOne({ 'email': req.body.email }, (err, user) => {
        if (err) res.status(400).send(err);
        else if (user) res.status(404).send(returnErrorMessage('El email ya existe en la base de datos'));
        else
           // bcrypt.hash(req.body.password, 10, (error, hash) => {
                User.create({
                    userId: req.body.userId || -1,
                    username: req.body.username || null,
                    name: req.body.name,
                    lastName: req.body.lastName,
                    password: req.body.password,
                    email: req.body.email,
                    avatar: req.body.avatar || null,
                    status: 0
                }, (err, response) => {
                    if (err) res.status(400).send(err);
                    else if (!response) res.status(404).send(returnErrorMessage('No se ha podido crear el usuario.'));
                    else res.json(returnSuccessJson(response))
                });
           // });

    });
});





/***** USER CRUD *****/
app.get(API_URL + 'user', (req, res, next) => { User.find({}).exec((error, response) => { res.status(200).send(response); }) });
app.get(API_URL + 'user/:id', (req, res, next) => { User.findOne({ email: req.query.userId }).exec((error, response) => { res.status(200).send(response); }) });
app.post(API_URL + 'user', (req, res, next) => { User.create(req.body, (error, response) => { res.status(200).send(response); }) });
//app.post(API_URL + 'user/login', (req, res, next) => { res.status(200).send('Login user'); });
app.patch(API_URL + 'user/:id', (req, res, next) => { User.update(req.body, (error, response) => { res.status(200).send(response); }) });
app.delete(API_URL + 'user/:id', (req, res, next) => { res.status(200).send('Remove user'); });

function returnErrorMessage(message) { return { success: false, error: message }; }

function returnSuccessJson(object) { return { success: true, data: object }; }

function isLogged(object) { return object && object.hasOwnProperty('user') && object['user'].hasOwnProperty('_id'); }

app.post('/api/user/logout', (req, res) => {
    if (!req.body._id || req.body.length === 0) res.status(401).send(returnErrorMessage('Usuario no válido para desloguear.'));
    else User.findById(req.body._id, (err, user) => {
        if (err) res.status(400).send(err);
        else if (!user || user === undefined) res.status(404).send(returnErrorMessage('Usuario no encontrado.'))
        else
           // bcrypt.compare(req.body.password, user.password, (error, verification) => {
                //if (err) res.status(400).send(err);
              //  if (verification)
                    Token.create({
                        token: jwt.sign({ email: req.body.email, timestamp: Date.now(), user: user }, SECRET_KEY, { expiresIn: '1h' }),
                        expirationDate: Math.floor(Date.now() / 1000) + (60 * 60),
                        user: user._id
                    }, (error, token) => {
                        req.session.user = user;
                        res.status(200).json(
                            returnSuccessJson({
                                user: [
                                    ['name', 'lastName', 'email', 'avatar', '_id', 'online'].reduce((result, key) => {
                                        result[key] = user[key];
                                        return result;
                                    }, {})
                                ],
                                token: token.token
                            }));
                    })

                //else res.status(401).send(returnErrorMessage('Contraseña inválida.'))
            //});
    });
});
app.post('/api/user/login', (req, res) => {

    if (!req.body.email || req.body.length === 0) res.status(401).send(returnErrorMessage('Email no válido.'));
    else User.findOne({ 'email': req.body.email }, (err, user) => {
        if (err) res.status(400).send(err);
        else if (!user || user === undefined) res.status(404).send(returnErrorMessage('Usuario no encontrado.'))
        else
            //bcrypt.compare(req.body.password, user.password, (error, verification) => {
              //  if (err) res.status(400).send(err);
                //if (verification)
                    Token.create({
                        token: jwt.sign({ email: req.body.email, timestamp: Date.now(), user: user }, SECRET_KEY, { expiresIn: '1h' }),
                        expirationDate: Math.floor(Date.now() / 1000) + (60 * 60),
                        user: user._id
                    }, (error, token) => {
                        req.session.user = user;
                        res.status(200).json(
                            returnSuccessJson({
                                user: [
                                    ['name', 'lastName', 'email', 'avatar', '_id', 'online'].reduce((result, key) => {
                                        result[key] = user[key];
                                        return result;
                                    }, {})
                                ],
                                token: token.token
                            }));
                    })

               // else res.status(401).send(returnErrorMessage('Contraseña inválida.'))
            //});
    });
});

/***** END USER CRUD *****/


// listen (start app with node server.js) ======================================

io.on('connection', function(client) {
    console.log('Client connected...');

    client.on('roomConnection', function(info) {
        console.log('Client: ' + client.id + ' has been connected to: ');
        console.log(info);
        const roomIndex = chatRooms.findIndex((room) => room['roomId'] === info.roomId);
        if (roomIndex !== -1) {
            console.log('Inserting new participant')
            const participantExists = chatRooms[roomIndex]['participants']
                .find((participant) => participant['idUser'] === info.userId);
            if (participantExists === undefined) {
                chatRooms[roomIndex]['participants'].push({
                    idUser: info.userId,
                    clientId: client.id
                });
                console.log('new participant added!')
                console.log(chatRooms[roomIndex])
            } else {
                const index = chatRooms[roomIndex]['participants'].findIndex((participant) => participant['idUser'] === info.userId);
                if (index !== -1) {
                    chatRooms[roomIndex]['participants'][index]['clientId'] = client.id;
                }
                console.log('participant exists! but we update the socket id');
                console.log(chatRooms[roomIndex])
                console.log(client.id);
            }
        } else {
            console.log('Inserting new chat room');
            chatRooms.push({
                roomId: info.roomId,
                participants: [{
                    idUser: info.userId,
                    clientId: client.id
                }],
                lastUpdate: Date.now()
            });
            console.log(chatRooms);
        }
    });

    client.on('forceDisconnect', (data) => {
        console.log('Desconectando al cliente -> ' + client.id);
    })
});