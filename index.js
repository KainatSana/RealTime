var express = require("express");
var app = new express();
var https = require('https');
var cors = require('cors');
const translatte = require('translatte');
var lineReader = require('line-reader');
var rl = require('readline-specific');
var readLastLines = require('read-last-lines');
var fs = require("fs");
var path = require('path');
var dir = './ImageData';
var multer = require('multer');
var MongoClient = require("mongodb").MongoClient;
var ObjectId = require("mongodb").ObjectID;
var BodyParser = require("body-parser");
var CONNECTION_URL = "mongodb://localhost:27017";
var DATABASE_NAME = "RealTime";
var database, collection;
var userSokArray = [];
var contact = [];
const port = process.env.PORT || 3000;
var key = fs.readFileSync('key.pem');
var cert = fs.readFileSync('cert.pem');
var options = {
    key: key,
    cert: cert
};
var httpsServer = https.createServer(options, app);
var io = require("socket.io")(httpsServer);
app.use(BodyParser.json());
app.use(express.urlencoded({
    extended: true
}));
app.use(BodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname + "/HTML"));
app.use(cors());
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});
app.get('/register', (req, res) => {
    console.log("Hit register");
    res.sendFile(__dirname + '/HTML/register.html');
});
app.get('/videoCall*', function (req, res) {
    res.sendFile(__dirname + '/HTML/video.html');
});
app.get('/audioCall*', function (req, res) {
    res.sendFile(__dirname + '/HTML/audio.html');
});
MongoClient.connect(CONNECTION_URL, function (error, client) {
    if (error) {
        throw error;
    }
    database = client.db(DATABASE_NAME);
    console.log("Connected to Local " + DATABASE_NAME + "!");
});
app.get('/user=:email', function (req, res) {
    collection = database.collection("USER");
    collection.find({ $or: [{ Email: req.params.email }, { PrimaryMobile: req.params.email }, { UserName: req.params.email }] }).toArray(function (err, result) {
        if (err) throw err;
        res.send(result);
    });
});
app.post('/fullName=:fullName,email=:email,dob=:dob,pass=:password,gender=:gender,country=:country', function (req, res) {
    let signUp = database.collection('USER');
    signUp.insertOne({ Name: req.params.fullName, Email: req.params.email, DOB: req.params.dob, Password: req.params.password, Gender: req.params.gender, Country: req.params.country }, function (err, result) {
        if (err) {
            throw err;
        }
        else {
            res.send("success");
        }
    });
});
app.get('/allConnections=:user', function (req, res) {
    var string = "" + req.params.user + "-CircleInfo";
    collection = database.collection(string);
    collection.aggregate([
        { $sort: { 'SortingDate': -1 } },
        {
            $lookup:
            {
                from: 'USER',
                localField: 'FriendID',
                foreignField: '_id',
                as: 'ProfilePicData'
            }
        },
        {
            $lookup: {
                from: "GroupInfo",
                localField: "FriendID",
                foreignField: "_id",
                as: "GroupInfo"
            }
        }
    ]).toArray(function (err, result) {
        if (err) throw err;
        res.send(result);
    });
});
app.get('/allFriendsForGrp=:user', function (req, res) {
    // var string = "" + req.params.user + "-CircleInfo";
    // let friendFind = database.collection(string);
    // friendFind.aggregate([
    //     { $match: { $and: [{ ContactType: "Person" }, { Status: "Active" }] } },
    //     {
    //         $lookup:
    //         {
    //             from: 'USER',
    //             localField: 'FriendID',
    //             foreignField: '_id',
    //             as: 'ProfilePicData'
    //         }
    //     }
    // ]).toArray(function (err, result) {
    //     if (err) throw err;
    //     res.send(result);
    // });
    let alluser = database.collection('USER');

    alluser.find({ _id: { $ne: ObjectId(req.params.user) } }).toArray(function (error, result) {
        if (error) throw err;
        res.send(result);
    });
});
app.get('/allGrpList=:user', function (req, res) {
    var string = "" + req.params.user + "-CircleInfo";
    collection = database.collection(string);
    collection.aggregate([
        { $sort: { _id: -1 } },
        { $match: { ContactType: "Group" } },
        {
            $lookup: {
                from: "GroupInfo",
                localField: "FriendID",
                foreignField: "_id",
                as: "GroupInfo"
            }
        }
    ]).toArray(function (err, result) {
        if (err) throw err;
        res.send(result);
    });
});
app.get('/callHistory=:user', function (req, res) {
    let callHistoryFind = database.collection('TestCallHistory');
    var ownId = req.params.user;
    callHistoryFind.aggregate([
        { $sort: { '_id': -1 } },
        { $match: { USER: { $elemMatch: { $eq: ObjectId(ownId) } } } },
        {
            $lookup:
            {
                from: 'GroupInfo',
                localField: 'GroupID',
                foreignField: '_id',
                as: 'GroupInfo'
            }
        },
        {
            $lookup: {
                from: "USER",
                localField: "GroupID",
                foreignField: "_id",
                as: "UserInfo"
            }
        },
        {
            $lookup: {
                from: "USER",
                localField: "CallCreator",
                foreignField: "_id",
                as: "CallCreatorInfo"
            }
        }
    ]).toArray(function (err, result) {
        if (err) throw err;
        res.send(result);
    });
});
var channels = {};
var sockets = {};

io.sockets.on('connection', function (socket) {
    socket.channels = {};
    sockets[socket.id] = socket;
    socket.on('disconnect', function () {
        for (var channel in socket.channels) {
            part(channel);
        }
        //console.log("[" + socket.id + "] disconnected");
        delete sockets[socket.id];
    });
    socket.on('loadPicForGroupAudio', function (data) {
        console.log("Hit from calling server");
        loadPicForGroupAudio(data);
    });
    socket.on('join', function (config) {
        //console.log("[" + socket.id + "] join ", config);
        var channel = config.channel;
        var userdata = config.userdata;
        if (channel in socket.channels) {
            //console.log("["+ socket.id + "] ERROR: already joined ", channel);
            return;
        }
        if (!(channel in channels)) {
            channels[channel] = {};
        }
        for (id in channels[channel]) {
            //console.log("Channel: " + userdata);
            channels[channel][id].emit('addPeer', { 'peer_id': socket.id, 'RemoteId': userdata, 'should_create_offer': false });
            socket.emit('addPeer', { 'peer_id': id, 'should_create_offer': true, 'RemoteId': userdata });
        }
        channels[channel][socket.id] = socket;
        socket.channels[channel] = channel;
    });
    function part(channel) {
        //console.log("["+ socket.id + "] part ");
        if (!(channel in socket.channels)) {
            //console.log("["+ socket.id + "] ERROR: not in ", channel);
            return;
        }
        delete socket.channels[channel];
        delete channels[channel][socket.id];

        for (id in channels[channel]) {
            channels[channel][id].emit('removePeer', { 'peer_id': socket.id });
            socket.emit('removePeer', { 'peer_id': id });
        }
    }
    socket.on('part', part);
    socket.on('relayICECandidate', function (config) {
        clearInterval();
        //console.log("Hit relayICeCandidate: " + config);
        var peer_id = config.peer_id;
        var ice_candidate = config.ice_candidate;
        //console.log("["+ socket.id + "] relaying ICE candidate to [" + peer_id + "] ", ice_candidate);
        if (peer_id in sockets) {
            sockets[peer_id].emit('iceCandidate', { 'peer_id': socket.id, 'ice_candidate': ice_candidate });
        }
        clearInterval();
    });
    socket.on('relaySessionDescription', function (config) {
        //console.log("HIT RELAY" + config.type_id);
        clearInterval();
        var peer_id = config.peer_id;
        var session_description = config.session_description;

        // console.log("["+ socket.id + "] relaying session description to [" + peer_id + "] ", session_description);
        if (peer_id in sockets) {
            sockets[peer_id].emit('sessionDescription', { 'peer_id': socket.id, 'session_description': session_description });
        }
        clearInterval();
    });
    socket.on('sentMsg', function (data) {
        sentMsg(data);
    });
    socket.on('loadAllData', function (data) {
        var userId = data.ownUserId;
        var selectUserId = data.selecId;
        var type = data.receiverMsgType;
        let load = database.collection("ChatHistoryForALL");
        let groupChatLoad = database.collection("GroupChatHistory");
        if (type === "Group") {
            groupChatLoad.aggregate(
                [
                    { $sort: { '_id': -1 } },
                    {
                        $match: {
                            $and: [
                                { GroupID: ObjectId(selectUserId) }
                            ]
                        }
                    },
                    {
                        $lookup: {
                            from: "USER",
                            localField: "SenderID",
                            foreignField: "_id",
                            as: "UserInfo"
                        }
                    }
                ]).toArray(function (error, result) {
                    if (error) {
                        throw error;
                    } else {
                        if (result.length !== 0) {
                            io.sockets.emit('loadFirstEight' + userId, result);
                        } else {
                            console.log("No data found");
                        }
                    }
                });

        } else {
            load.aggregate(
                [
                    { $sort: { '_id': -1 } },
                    {
                        $match: {
                            $and: [
                                { $or: [{ SenderID: ObjectId(userId) }, { ReceiverId: ObjectId(userId) }] },
                                { $or: [{ SenderID: ObjectId(selectUserId) }, { ReceiverId: ObjectId(selectUserId) }] }
                            ]
                        }
                    },
                    {
                        $lookup: {
                            from: "USER",
                            localField: "SenderID",
                            foreignField: "_id",
                            as: "UserInfo"
                        }
                    }
                ]).toArray(function (error, result) {
                    if (error) {
                        throw error;
                    } else {
                        if (result.length !== 0) {
                            io.sockets.emit('loadFirstEight' + userId, result);
                        } else {
                            console.log("No data found");
                        }
                    }
                });
        }
    });
    socket.on('testCallHistoryPrivateToServer', function (data) {
        var ownUser = data.slice(0, data.indexOf('ID:'));
        var groupId = data.slice(data.indexOf('ID:') + 3, data.indexOf('StartTime:'));
        var startTime = data.slice(data.indexOf('StartTime:') + 10, data.indexOf('JoinString:'));
        var joinString = data.slice(data.indexOf('JoinString:') + 11, data.indexOf('Type:'));
        var uniqueChannel = data.slice(data.indexOf('UniqueId:') + 9);
        var typeCall = data.slice(data.indexOf('Type:') + 5, data.indexOf('UniqueId:'));
        let callHistorySave = database.collection('TestCallHistory');
        let calleNameFind = database.collection('USER');
        callHistorySave.find({ $and: [{ ActiveUSER: { $elemMatch: { $eq: ObjectId(ownUser) } } }, { Status: "Active" }] }).toArray(function (error, result) {
            if (result.length === 0) {
                console.log("NO CALL ACTIVE ");
                if (typeCall === "Audio") {
                    callHistorySave.insertOne({ GroupID: ObjectId(groupId), USER: [ObjectId(ownUser), ObjectId(groupId)], ActiveUSER: [ObjectId(ownUser)], JoinString: joinString, Status: "Active", MemberNumber: 2, CallType: typeCall, CallCreator: ObjectId(ownUser), TypeOfCall: "Private", UniqueChannel: uniqueChannel }, function (error, result) {
                        //console.log(result.ops[0]);
                        calleNameFind.find({ _id: ObjectId(ownUser) }).toArray(function (error, result) {
                            var privateMemberArray = [];
                            privateMemberArray.push(result[0].ProfilePicture);
                            privateMemberArray.push(result[0].Name);
                            privateMemberArray.push(ownUser);
                            privateMemberArray.push(groupId);
                            privateMemberArray.push(groupId);
                            privateMemberArray.push(uniqueChannel);
                            console.log("hit alert for chat server");
                            callAudioRing(privateMemberArray)
                            // socket2.emit('PrivateAudioCallALert', privateMemberArray);
                        });
                    });
                } else {
                    callHistorySave.insertOne({ GroupID: ObjectId(groupId.trim()), USER: [ObjectId(ownUser.trim()), ObjectId(groupId.trim())], ActiveUSER: [ObjectId(ownUser.trim())], JoinString: joinString, Status: "Active", MemberNumber: 2, CallType: typeCall, CallCreator: ObjectId(ownUser.trim()), TypeOfCall: "Private", UniqueChannel: uniqueChannel }, function (error, result) {
                        //console.log(result.ops[0]);
                        calleNameFind.find({ _id: ObjectId(ownUser) }).toArray(function (error, result) {
                            var privateMemberArray = [];
                            privateMemberArray.push(result[0].ProfilePicture);
                            privateMemberArray.push(result[0].Name);
                            privateMemberArray.push(ownUser.trim());
                            privateMemberArray.push(groupId.trim());
                            privateMemberArray.push(groupId.trim());
                            privateMemberArray.push(uniqueChannel);
                            callVideoRing(privateMemberArray)
                        });
                    });
                }
            } else {
                console.log("AVOID 2ND TIME CALL HISTORY SAVE");
            }
        });
    });
    socket.on('msgDeleteForEveryOne', function (data) {
        let msgId = data.msgid;
        let userId = data.User;
        let selelctedUSerId = data.Selected;
        var type = data.Type;
        let deleteMsgFromUser = database.collection("ChatHistoryForALL");
        let groupMsgUnsent = database.collection('GroupChatHistory');
        let findGroupMember = database.collection('GroupInfo');
        if (type === "Group") {
            groupMsgUnsent.deleteOne({ _id: ObjectId(msgId) }, function (error, result) {
                if (error) {
                    throw error;
                }
                findGroupMember.find({ _id: ObjectId(selelctedUSerId) }).toArray(function (error, result) {
                    if (error) {
                        throw error;
                    } else {
                        for (var i = 0; i < result[0].MembersID.length; i++) {
                            io.sockets.emit('deleteforReceiver' + result[0].MembersID[i], msgId);
                        }
                    }
                });
            });
        } else {
            deleteMsgFromUser.deleteOne({ _id: ObjectId(msgId) },
                function (error, result) {
                    if (error)
                        throw error;
                    io.sockets.emit('deleteforReceiver' + selelctedUSerId, msgId);
                    io.sockets.emit('deleteforEveryOneSender' + userId, msgId);


                });
        }
    });
    socket.on('createGroup', function (data) {
        var d = new Date();
        var dateTime = ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + "/" +
            d.getFullYear() + " " + formatTime(d);
        var groupName = data[0].GrpName;
        var memberName = [];
        var memberId = [];
        var lastGroupId;
        for (var j = 1; j < data.length; j++) {
            memberName.push(data[j].Name);
            memberId.push(ObjectId(data[j].ID));
        }
        let groupCreate = database.collection("GroupInfo");
        groupCreate.insertOne({ GroupName: groupName, MembersName: memberName, MembersID: memberId, Admin: ObjectId(data[1].ID), Privacy: "Private", DatetTime: dateTime },
            function (err, result) {
                if (err) {
                    throw err;
                }
                lastGroupId = result.insertedId;
                for (var i = 1; i < data.length; i++) {
                    let addGroupInContact = database.collection(data[i].ID + "-CircleInfo");
                    addGroupInContact.insertOne({ FriendID: ObjectId(lastGroupId), DateTime: dateTime, ContactType: 'Group', SortingDate: Date.now() }, function (error, result) {
                        if (error) throw error;
                    });
                    io.sockets.emit('memberAlertForGrpAdd' + data[i].ID, "Done");
                }

            });
    });
    socket.on('testCallHistoryPrivateJoin', function (data) {
        var ownUser = data.slice(0, data.indexOf('ID:'));
        var groupId = data.slice(data.indexOf('ID:') + 3);
        let callHistorySave = database.collection('TestCallHistory');
        callHistorySave.updateOne({ $and: [{ GroupID: ObjectId(ownUser) }, { Status: "Active" }] }, { $push: { ActiveUSER: ObjectId(ownUser) } }, { upsert: true }, function (error, result) {
            //console.log(result.ops[0]);
        });
    });
    socket.on('CallDurationExact', function (data) {
        let callHistorySave = database.collection('TestCallHistory');
        callHistorySave.updateOne({ $and: [{ UniqueChannel: data }, { Status: "Active" }] }, { $set: { StartTime: Date.now() } }, { upsert: true }, function (error, result) {
            console.log(Date.now());
        });
    });
    socket.on('EndPrivateVideoCall', function (data) {
        console.log("Hit call: " + data);
        endPrivateCall(data, "Video");
    });
    socket.on('EndPrivateAudioCall', function (data) {
        console.log("Hit call AUdio: " + data);
        endPrivateCall(data,"Audio");
    });
    socket.on('deleteCallHistory', function (data) {
        var userId= data.OwnId;
        var msgId= data.ID;
        let deleteMsgFromUser = database.collection("TestCallHistory");
        deleteMsgFromUser.deleteOne({ _id: ObjectId(msgId) }, function (error, result) {
            if (error) {
                throw error;
            }else{
                io.sockets.emit('successdeleteCallHistory' + userId, msgId);
            }
        });
    });
    
    socket.on('loadProfilePictureForGrpCall', function (data) {
        var userId = data.slice(0, data.indexOf('Select:'));
        var selecId = data.slice(data.indexOf('Select:') + 7);
        let loadPic = database.collection('USER');
        loadPic.find({ _id: ObjectId(selecId) }).toArray(function (errro, result) {
            //console.log(result);
            if (result[0].ProfileIcon === '' || result[0].ProfileIcon === undefined || result[0].ProfileIcon === null) {
                if (result[0].Gender === "Male") {
                    result[0].ProfileIcon = "image/user-profile.png";
                } else {
                    result[0].ProfileIcon = "image/female.jpg";
                }
            }
            socket.emit('loadProfilePictureForGrpCallToServer' + userId, selecId + "Select:" + result[0].Name + "data:" + result[0].ProfileIcon);
        });
    });
});
function endPrivateCall(data, endType) {
    var d = new Date();
    var datetime = ("0" + d.getDate()).slice(-2) +
        "/" +
        ("0" + (d.getMonth() + 1)).slice(-2) +
        "/" +
        d.getFullYear() +
        " " +
        formatTime(d);
    var value = [];
    var callCreatorId, callReceiverId;
    var startTime, duration;
    let callEnd = database.collection('TestCallHistory');
    callEnd.find({ $and: [{ UniqueChannel: data }, { Status: "Active" }] }).toArray(function (error, result) {
        if (error) {
            console.log(error);
        } else {
            if (result.length === 0) {
                console.log("Start Time undefined 2nd time");
            } else {
                if (result[0].StartTime === '' || result[0].StartTime === undefined || result[0].StartTime === null) {
                    console.log("Start time 0 assign");
                    duration = "0.00";
                } else {
                    startTime = result[0].StartTime;
                    var endDate = Date.now();
                    function millisToMinutesAndSeconds(millis) {
                        var minutes = Math.floor(millis / 60000);
                        var seconds = ((millis % 60000) / 1000).toFixed(0);
                        return minutes + ":" + (seconds < 10 ? '0' : '') + seconds;
                    }
                    duration = millisToMinutesAndSeconds(endDate - startTime);
                }
                value = result[0].USER;
                callCreatorId = result[0].CallCreator;
                callReceiverId = result[0].GroupID;

                callEnd.updateOne({ $and: [{ UniqueChannel: data }, { Status: "Active" }] }, { $set: { ActiveUSER: [], MemberNumber: 0, Status: "None", CallDuration: duration, EndTime: datetime } }, { upsert: true }, function (errpo, endResult) {
                    if (errpo) {
                        throw errpo
                    } else {
                        console.log("Successfully ENd Call");
                    }
                });
                for (var i = 0; i < value.length; i++) {
                    io.sockets.emit('PrivateCallEndCompletely' + value[i], data);
                }
            }
        }

    });
}
function formatTime(date) {
    var hours = date.getHours();
    var minutes = date.getMinutes();
    var am = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    minutes = minutes < 10 ? '0' + minutes : minutes;
    var strTime = hours + ':' + minutes + ' ' + am;
    return strTime;
}
function callAudioRing(data,endType) {
    var value = data[data.length - 1];
    var calleName = data[data.length - 2];
    var groupId = data[data.length - 3];
    var ownId = data[data.length - 4];
    var callCreatorName = data[data.length - 5];
    var callCreatorPic = data[data.length - 6];
    let check = database.collection('TestCallHistory');
    check.find({ $and: [{ ActiveUSER: { $elemMatch: { $eq: ObjectId(groupId) } } }, { Status: "Active" }] }).toArray(function (error, result) {
        if (result.length === 0) {
            io.sockets.emit('PrivateAudioCallRinging' + groupId, value + "Name:" + calleName + "ID:" + groupId + "user:" + ownId + "CallerName:" + callCreatorName + "Pic:" + callCreatorPic);
        } else {
            // io.sockets.emit('checkAnyCallExistforRingResults' + data[1], calleName);
        }
    });
}
function callVideoRing(data) {
    var value = data[data.length - 1];
    var calleName = data[data.length - 2];
    var groupId = data[data.length - 3];
    var ownId = data[data.length - 4];
    var callCreatorName = data[data.length - 5];
    var callCreatorPic = data[data.length - 6];
    let check = database.collection('TestCallHistory');
    check.find({ $and: [{ ActiveUSER: { $elemMatch: { $eq: ObjectId(groupId) } } }, { Status: "Active" }] }).toArray(function (error, result) {
        if (result.length === 0) {
            io.emit('PrivateVideoCallRinging' + groupId, value + "Name:" + calleName + "ID:" + groupId + "user:" + ownId + "CallerName:" + callCreatorName + "Pic:" + callCreatorPic);
        } else {
            io.sockets.emit('checkAnyCallExistforRingResults' + data[1], "Yes");
        }
    });
}
function sentMsg(data) {
    var ownUserId = data.ownUserId;
    var sendUserId = data.senderId;
    var receiverId = data.receiverId;
    var msg = data.msg;
    var datetime = data.timeStamp;
    var msgType = data.msgType;
    var receiverType = data.ReceiverType
    var status = "unseen";
    if (receiverType === "Group") {
        var groupChat = database.collection("GroupChatHistory");
        groupChat.insertOne({
            SenderID: ObjectId(sendUserId),
            ReceiverID: ObjectId(00000),
            GroupID: ObjectId(receiverId),
            Message: msg,
            TranslatedText: "",
            Type: msgType,
            Status: status,
            SenderStatus: 'Active',
            ReceiverStatus: 'Active',
            DateTime: datetime,
            ChatType: "Group Chat"
        },
            function (error, result) {
                if (error) {
                    throw err;
                } else {
                    var newMsgId = result.insertedId;
                    var lastGrpMessage, lastGrpId, lastGrpMsgType, lastGrpMsgSender, lastGrpDate;
                    var loadGroupLastRow = database.collection("GroupChatHistory");
                    loadGroupLastRow.aggregate(
                        [
                            {
                                $match: {
                                    _id: ObjectId(newMsgId)
                                }
                            },
                            {
                                $lookup: {
                                    from: "USER",
                                    localField: "SenderID",
                                    foreignField: "_id",
                                    as: "UserInfo"
                                }
                            }
                        ]).toArray(function (error, lastRowGrpMsg) {
                            if (error) {
                                throw error;
                            } else {
                                if (lastRowGrpMsg.length === 0) {

                                } else {
                                    let findGroupMember = database.collection("GroupInfo");

                                    lastGrpId = lastRowGrpMsg[0]._id;
                                    lastGrpMessage = lastRowGrpMsg[0].Message
                                    lastGrpMsgType = lastRowGrpMsg[0].Type
                                    lastGrpMsgSender = lastRowGrpMsg[0].SenderID
                                    lastGrpDate = lastRowGrpMsg[0].DateTime;
                                    findGroupMember.find({ _id: ObjectId(lastRowGrpMsg[0].GroupID) }).toArray(function (error, result) {
                                        if (error) {
                                            throw error;
                                        } else {
                                            for (var j = 0; j < result[0].MembersID.length; j++) {
                                                io.sockets.emit('testingReceive' + result[0].MembersID[j], lastRowGrpMsg);
                                            }
                                        }
                                    });
                                    translatte(lastGrpMessage, { to: 'ur' }).then(res => {
                                        var translatedText = res.text;
                                        groupChat.updateOne({ _id: lastGrpId }, { $set: { TranslatedText: translatedText } }, { upsert: true }, function (er, response) {
                                            findGroupMember.find({ _id: ObjectId(lastRowGrpMsg[0].GroupID) }).toArray(function (error, result) {
                                                if (error) {
                                                    throw error;
                                                } else {
                                                    for (var j = 0; j < result[0].MembersID.length; j++) {
                                                        io.sockets.emit('translateMsgResult' + result[0].MembersID[j], { "Id": lastGrpId, "Text": translatedText });
                                                    }
                                                }
                                            });
                                        });
                                    }).catch(err => {
                                        console.error(err);
                                    });
                                    findGroupMember.find({ _id: ObjectId(lastRowGrpMsg[0].GroupID) }).toArray(function (error, memberResult) {
                                        if (error) {
                                            throw error;
                                        } else {
                                            for (var m = 0; m < memberResult[0].MembersID.length; m++) {
                                                var CircleInfoUpdateForGrp = database.collection(memberResult[0].MembersID[m] + "-CircleInfo");
                                                CircleInfoUpdateForGrp.updateOne({ FriendID: ObjectId(lastRowGrpMsg[0].GroupID) },
                                                    {
                                                        $set: {
                                                            FriendID: ObjectId(lastRowGrpMsg[0].GroupID),
                                                            DateTime: datetime,
                                                            ContactType: "Group",
                                                            SortingDate: Date.now()
                                                        }
                                                    },
                                                    { upsert: true },
                                                    function (error, result) {
                                                        if (error) throw error;
                                                        io.sockets.emit('saveConnectionSuccess' + memberResult[0].MembersID[m], "done");
                                                    });
                                            }
                                        }
                                    });
                                }
                            }
                        });

                }
            });
    }
    else {
        var chat = database.collection("ChatHistoryForALL");
        var senderCircleInfoUpdate = database.collection(sendUserId + "-CircleInfo");
        var receiverCircleInfoUpdate = database.collection(receiverId + "-CircleInfo");
        //console.log(msgType);

        chat.insertOne({
            SenderID: ObjectId(sendUserId),
            ReceiverId: ObjectId(receiverId),
            Message: msg,
            TranslatedText: "",
            Type: msgType,
            Status: status,
            SenderStatus: 'Active',
            ReceiverStatus: 'Active',
            DateTime: datetime,
            ChatType: "Private Chat",
        },
            function (error, result) {
                if (error) {
                    throw err;
                } else {
                    var newMsgId = result.insertedId;
                    var lastMessage, lastMsgType, lastmsgSender, lastmsgreceiver, lastmsgDate;
                    var loadLastRow = database.collection("ChatHistoryForALL");
                    loadLastRow.aggregate(
                        [
                            {
                                $match: {
                                    _id: ObjectId(newMsgId)
                                }
                            },
                            {
                                $lookup: {
                                    from: "USER",
                                    localField: "SenderID",
                                    foreignField: "_id",
                                    as: "UserInfo"
                                }
                            }
                        ]).toArray(function (error, lastRowresult) {
                            if (error) {
                                throw error;
                            } else {
                                if (lastRowresult.length === 0) {

                                } else {
                                    //console.log(lastRowresult);
                                    lastMsgId = lastRowresult[0]._id;
                                    lastMessage = lastRowresult[0].Message
                                    lastMsgType = lastRowresult[0].Type
                                    lastmsgSender = lastRowresult[0].SenderID
                                    lastmsgreceiver = lastRowresult[0].ReceiverId
                                    lastmsgDate = lastRowresult[0].DateTime;

                                    io.sockets.emit('rcvOwnMsg' + ownUserId, lastRowresult);
                                    io.sockets.emit('sndToRcvr' + lastRowresult[0].ReceiverId, lastRowresult);
                                    translatte(lastMessage, { to: 'ur' }).then(res => {
                                        var translatedText = res.text;
                                        chat.updateOne({ _id: lastMsgId }, { $set: { TranslatedText: translatedText } }, { upsert: true }, function (er, response) {
                                            io.sockets.emit('translateMsgResult' + ownUserId, { "Id": lastMsgId, "Text": translatedText });
                                            io.sockets.emit('translateMsgResult' + lastRowresult[0].ReceiverId, { "Id": lastMsgId, "Text": translatedText });

                                        });
                                    }).catch(err => {
                                        console.error(err);
                                    });
                                    senderCircleInfoUpdate.updateOne({ FriendID: ObjectId(receiverId) },
                                        {
                                            $set: {
                                                FriendID: ObjectId(receiverId),
                                                DateTime: datetime,
                                                ContactType: "Person",
                                                SortingDate: Date.now()
                                            }
                                        },
                                        { upsert: true },
                                        function (error, result) {
                                            if (error) throw error;
                                            io.sockets.emit('saveConnectionSuccess' + sendUserId, "done");

                                        });

                                    receiverCircleInfoUpdate.updateOne({ FriendID: ObjectId(sendUserId) },
                                        {
                                            $set: {
                                                DateTime: datetime,
                                                ContactType: "Person",
                                                SortingDate: Date.now()
                                            }
                                        },
                                        { upsert: true },
                                        function (error, result) {
                                            if (error) throw error;
                                            io.sockets.emit('saveConnectionSuccess' + receiverId, "done");

                                        });
                                }
                            }
                        });
                }
            });
    }
}
function loadPicForGroupAudio(data) {
    //console.log("loadPicForGroupAudio hit");
    var groupAudioProfilePicArray = [];
    var profilepic, individualName;
    var userdata = data.slice(0, data.indexOf('ID:'));
    var groupId = data.slice(data.indexOf('ID:') + 3);
    let calleNameFind = database.collection('USER');
    let findGroupMember = database.collection('GroupInfo');
    let callEnd = database.collection('TestCallHistory');
    callEnd.aggregate([
        { $match: { $and: [{ GroupID: ObjectId(groupId) }, { Status: "Active" }] } },
        {
            $lookup:
            {
                from: 'USER',
                localField: 'ActiveUSER',
                foreignField: '_id',
                as: 'GroupAudioPPic'
            }
        }]).toArray(function (error, json) {
            if (json.length === 0) {
                console.log("EMPTY JSON");
            } else {
                //console.log(json);
                for (var i = 0; i < json[0].GroupAudioPPic.length; i++) {
                    if (json[0].GroupAudioPPic[i].ProfilePicture === '' ||
                        json[0].GroupAudioPPic[i].ProfilePicture === null ||
                        json[0].GroupAudioPPic[i].ProfilePicture === undefined) {
                        if (json[0].GroupAudioPPic[i].Gender === "Male") {
                            profilepic = "image/Square/Male-icon.svg";
                        } else {
                            profilepic = "image/Square/Female-icon.svg";
                        }
                    } else {
                        profilepic = json[0].GroupAudioPPic[i].ProfilePicture;
                    }
                    individualName = json[0].GroupAudioPPic[i].Name;
                    var totalIndividualinfo = {
                        Name: individualName,
                        Pic: profilepic
                    };
                    groupAudioProfilePicArray.push(totalIndividualinfo);
                }
                findGroupMember.find({ _id: ObjectId(groupId) }).toArray(function (error, result) {
                    if (error) {
                        throw error;
                    } else {
                        for (var j = 0; j < result[0].MembersID.length; j++) {
                            //console.log(groupAudioProfilePicArray.length);
                            io.sockets.emit('loadProfilePictureAfterJoin' + result[0].MembersID[j], groupAudioProfilePicArray);
                        }
                    }
                });
                //socket.emit('PrivateAudioCallALert', privateMemberArray);

            }
        });
}
httpsServer.listen(port, () => {
    console.log("server starting on port : " + port);
});