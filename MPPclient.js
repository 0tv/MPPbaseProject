if(typeof module !== "undefined") {
	module.exports = Client;
	var WebSocket = require("ws");
	var EventEmitter = require("events").EventEmitter;
	var HttpsProxyAgent = require("https-proxy-agent");
	var SocksProxyAgent = require("socks-proxy-agent");
} else {
	this.Client = Client;
}


function mixin(obj1, obj2) {
	for(var i in obj2) {
		if(obj2.hasOwnProperty(i)) {
			obj1[i] = obj2[i];
		}
	}
};


function Client(uri, proxy, options) {
	EventEmitter.call(this);
	let bp = binPatch(this);
	let dp = drawPatch(this);
	this.binPatch = bp;
	this.drawPatch = dp;
	this.draw = this.mkline = this.drawPatch.mkline;
	this.drawJSON = this.drawObject = this.drawPatch.drawJSON;
	this.uri = uri || "wss://www.multiplayerpiano.com";
	this.options = options || {
		origin: "https://multiplayerpiano.com"
	};
	this.binaryNotes = options.binaryNotes || false;
	this.origin = this.options.origin;
	this.userAgent = this.options.ua || this.options.userAgent || this.options.useragent || this.options['User-Agent'];
	this.localAddress = this.options.localAddress || this.options.address || this.options.addr;
	this.proxy = proxy;
	this.ws = undefined;
	this.serverTimeOffset = 0;
	this.user = undefined;
	this.participantId = undefined;
	this.channel = undefined;
	this.ppl = {};
	this.connectionTime = undefined;
	this.connectionAttempts = 0;
	this.desiredChannelId = undefined;
	this.desiredChannelSettings = undefined;
	this.pingInterval = undefined;
	this.canConnect = false;
	this.noteBuffer = [];
	this.noteBufferTime = 0;
	this.noteFlushInterval = undefined;

	this.bindEventListeners();

	this.emit("status", "(Offline mode)");
	
	this.keys = ['a-1', 'as-1', 'b-1',
	'c0', 'cs0', 'd0', 'ds0', 'e0', 'f0', 'fs0', 'g0', 'gs0', 'a0', 'as0', 'b0',
	'c1', 'cs1', 'd1', 'ds1', 'e1', 'f1', 'fs1', 'g1', 'gs1', 'a1', 'as1', 'b1',
	'c2', 'cs2', 'd2', 'ds2', 'e2', 'f2', 'fs2', 'g2', 'gs2', 'a2', 'as2', 'b2',
	'c3', 'cs3', 'd3', 'ds3', 'e3', 'f3', 'fs3', 'g3', 'gs3', 'a3', 'as3', 'b3',
	'c4', 'cs4', 'd4', 'ds4', 'e4', 'f4', 'fs4', 'g4', 'gs4', 'a4', 'as4', 'b4',
	'c5', 'cs5', 'd5', 'ds5', 'e5', 'f5', 'fs5', 'g5', 'gs5', 'a5', 'as5', 'b5',
	'c6', 'cs6', 'd6', 'ds6', 'e6', 'f6', 'fs6', 'g6', 'gs6', 'a6', 'as6', 'b6', 
	'c7'];
};

mixin(Client.prototype, EventEmitter.prototype);

Client.prototype.constructor = Client;

Client.prototype.isSupported = function() {
	return typeof WebSocket === "function";
};

Client.prototype.isConnected = function() {
	return this.isSupported() && this.ws && this.ws.readyState === WebSocket.OPEN;
};

Client.prototype.isConnecting = function() {
	return this.isSupported() && this.ws && this.ws.readyState === WebSocket.CONNECTING;
};

Client.prototype.start = function() {
	this.canConnect = true;
	this.connect();
};

Client.prototype.stop = function() {
	this.canConnect = false;
	this.ws.close();
};

Client.prototype.connect = function() {
	if(!this.canConnect || !this.isSupported() || this.isConnected() || this.isConnecting())
		return;
	this.emit("status", "Connecting...");
	if(typeof module !== "undefined") {
		// nodejsicle
		let extra = { headers: {} };
		if(this.localAddress) extra.localAddress = this.localAddress;
		if(this.userAgent) extra.headers['User-agent'] = this.userAgent;
		if(this.origin) extra.headers['origin'] = this.origin;
		
		this.ws = new WebSocket(this.uri, {
			agent: this.proxy ? this.proxy.startsWith("socks") ? new SocksProxyAgent(this.proxy) : new HttpsProxyAgent(this.proxy) : undefined,
			...extra
		});
	} else {
		// browseroni
		this.ws = new WebSocket(this.uri);
	}
	this.ws.binaryType = "arraybuffer";
	var self = this;
	this.ws.addEventListener("close", function(evt) {
		self.user = undefined;
		self.participantId = undefined;
		self.channel = undefined;
		self.setParticipants([]);
		clearInterval(self.pingInterval);
		clearInterval(self.noteFlushInterval);

		self.emit("disconnect");
		self.emit("status", "Offline mode");

		// reconnect!
		if(self.connectionTime) {
			self.connectionTime = undefined;
			self.connectionAttempts = 0;
		} else {
			++self.connectionAttempts;
		}
		var ms_lut = [50, 2950, 7000, 10000];
		var idx = self.connectionAttempts;
		if(idx >= ms_lut.length) idx = ms_lut.length - 1;
		var ms = ms_lut[idx];
		setTimeout(self.connect.bind(self), ms);
	});
	this.ws.addEventListener("error", function(error) {
		self.emit("error", error);
	});
	this.ws.addEventListener("open", function(evt) {
		self.connectionTime = Date.now();
		self.sendArray([{m: "hi"}]);
		self.pingInterval = setInterval(function() {
			self.sendArray([{m: "t", e: Date.now()}]);
		}, 20000);
		//self.sendArray([{m: "t", e: Date.now()}]);
		self.noteBuffer = [];
		self.noteBufferTime = 0;
		self.noteFlushInterval = setInterval(function() {
			if(self.noteBufferTime && self.noteBuffer.length > 0) {
				self.sendArray([{m: "n", t: self.noteBufferTime + self.serverTimeOffset, n: self.noteBuffer}]);
				self.noteBufferTime = 0;
				self.noteBuffer = [];
			};
			
			// console.log(self.binPatch);
			self.binPatch.flush();
			self.drawPatch.flush();
		}, 200);

		self.emit("connect");
		self.emit("status", "Joining channel...");
	});
	this.ws.addEventListener("message", function(evt) {
		self.emit("message", evt);
		if (typeof evt.data !== "string") return;
		try {
			var transmission = JSON.parse(evt.data);
			for(var i = 0; i < transmission.length; i++) {
				var msg = transmission[i];
				self.emit(msg.m, msg);
			}
		} catch(e) {
			self.emit("error", e);
		}
	});
};

Client.prototype.bindEventListeners = function() {
	var self = this;
	this.on("hi", function(msg) {
		self.user = msg.u;
		self.receiveServerTime(msg.t, msg.e || undefined);
		if(self.desiredChannelId) {
			self.setChannel();
		}
	});
	this.on("t", function(msg) {
		self.receiveServerTime(msg.t, msg.e || undefined);
	});
	this.on("ch", function(msg) {
		self.desiredChannelId = msg.ch._id;
		self.channel = msg.ch;
		if(msg.p) self.participantId = msg.p;
		self.setParticipants(msg.ppl);
	});
	this.on("p", function(msg) {
		self.participantUpdate(msg);
		self.emit("participant update", self.findParticipantById(msg.id));
	});
	this.on("m", function(msg) {
		if(self.ppl.hasOwnProperty(msg.id)) {
			self.participantUpdate(msg);
		}
	});
	this.on("bye", function(msg) {
		self.removeParticipant(msg.p);
	});
};

Client.prototype.send = function(raw) {
	if(this.isConnected()) this.ws.send(raw);
};

Client.prototype.sendArray = function(arr) {
	this.send(JSON.stringify(arr));
};

Client.prototype.setChannel = function(id, set) {
	this.desiredChannelId = id || this.desiredChannelId || "lobby";
	this.desiredChannelSettings = set || this.desiredChannelSettings || undefined;
	this.sendArray([{m: "ch", _id: this.desiredChannelId, set: this.desiredChannelSettings}]);
};

Client.prototype.offlineChannelSettings = {
	lobby: true,
	visible: false,
	chat: false,
	crownsolo: false,
	color:"#ecfaed"
};

Client.prototype.getChannelSetting = function(key) {
	if(!this.isConnected() || !this.channel || !this.channel.settings) {
		return this.offlineChannelSettings[key];
	} 
	return this.channel.settings[key];
};

Client.prototype.offlineParticipant = {
	_id: "",
	name: "",
	color: "#777"
};

Client.prototype.getOwnParticipant = function() {
	return this.findParticipantById(this.participantId);
};

Client.prototype.setParticipants = function(ppl) {
	// remove participants who left
	for(var id in this.ppl) {
		if(!this.ppl.hasOwnProperty(id)) continue;
		var found = false;
		for(var j = 0; j < ppl.length; j++) {
			if(ppl[j].id === id) {
				found = true;
				break;
			}
		}
		if(!found) {
			this.removeParticipant(id);
		}
	}
	// update all
	for(var i = 0; i < ppl.length; i++) {
		this.participantUpdate(ppl[i]);
	}
};

Client.prototype.countParticipants = function() {
	var count = 0;
	for(var i in this.ppl) {
		if(this.ppl.hasOwnProperty(i)) ++count;
	}
	return count;
};

Client.prototype.participantUpdate = function(update) {
	var part = this.ppl[update.id] || null;
	if(part === null) {
		part = update;
		this.ppl[part.id] = part;
		this.emit("participant added", part);
		this.emit("count", this.countParticipants());
	} else {
		if(update.x) part.x = update.x;
		if(update.y) part.y = update.y;
		if(update.color) part.color = update.color;
		if(update.name) part.name = update.name;
	}
};

Client.prototype.removeParticipant = function(id) {
	if(this.ppl.hasOwnProperty(id)) {
		var part = this.ppl[id];
		delete this.ppl[id];
		this.emit("participant removed", part);
		this.emit("count", this.countParticipants());
	}
};

Client.prototype.findParticipantById = function(id) {
	return this.ppl[id] || this.offlineParticipant;
};

Client.prototype.isOwner = function() {
	return this.channel && this.channel.crown && this.channel.crown.participantId === this.participantId;
};

Client.prototype.preventsPlaying = function() {
	return this.isConnected() && !this.isOwner() && this.getChannelSetting("crownsolo") === true;
};

Client.prototype.receiveServerTime = function(time, echo) {
	var self = this;
	var now = Date.now();
	var target = time - now;
	//console.log("Target serverTimeOffset: " + target);
	var duration = 1000;
	var step = 0;
	var steps = 50;
	var step_ms = duration / steps;
	var difference = target - this.serverTimeOffset;
	var inc = difference / steps;
	var iv;
	iv = setInterval(function() {
		self.serverTimeOffset += inc;
		if(++step >= steps) {
			clearInterval(iv);
			//console.log("serverTimeOffset reached: " + self.serverTimeOffset);
			self.serverTimeOffset=target;
		}
	}, step_ms);
	// smoothen

	//this.serverTimeOffset = time - now;			// mostly time zone offset ... also the lags so todo smoothen this
								// not smooth:
	//if(echo) this.serverTimeOffset += echo - now;	// mostly round trip time offset
};

Client.prototype.startNote = function(note, vel) {
	if(this.binaryNotes) return this.binStartNote(note, vel);
	if(this.isConnected()) {
		var vel = typeof vel === "undefined" ? undefined : +vel.toFixed(3);
		if(!this.noteBufferTime) {
			this.noteBufferTime = Date.now();
			this.noteBuffer.push({n: note, v: vel});
		} else {
			this.noteBuffer.push({d: Date.now() - this.noteBufferTime, n: note, v: vel});
		}
	}
};

Client.prototype.stopNote = function(note) {
	if(this.binaryNotes) return this.binStopNote(note);
	if(this.isConnected()) {
		if(!this.noteBufferTime) {
			this.noteBufferTime = Date.now();
			this.noteBuffer.push({n: note, s: 1});
		} else {
			this.noteBuffer.push({d: Date.now() - this.noteBufferTime, n: note, s: 1});
		}
	}
};



/* extended methods */

Client.prototype.say = function (message) {
	this.sendArray([{m: "a", message}]);
};

Client.prototype.userset = function (set) {
	this.sendArray([{m: "userset", set}]);
};

Client.prototype.setName = function (name) {
	this.userset({name});
};

Client.prototype.moveMouse = function (x, y) {
	this.sendArray([{m: "m", x, y}]);
};

Client.prototype.kickBan = function (_id, ms) {
	this.sendArray([{m: "kickban", _id, ms}]);
};

Client.prototype.chown = function (id) {
	this.sendArray([{m: "chown", id}]);
};

Client.prototype.chset = function (set) {
	this.sendArray([{m: "chset", set}]);
}; 

// binary notes
function binPatch(client) {	
	let addon = {};
	addon.keysarr = ['a-1', 'as-1', 'b-1', 'c0', 'cs0', 'd0', 'ds0', 'e0', 'f0', 'fs0', 'g0', 'gs0', 'a0', 'as0', 'b0', 'c1', 'cs1', 'd1', 'ds1', 'e1', 'f1', 'fs1', 'g1', 'gs1', 'a1', 'as1', 'b1', 'c2', 'cs2', 'd2', 'ds2', 'e2', 'f2', 'fs2', 'g2', 'gs2', 'a2', 'as2', 'b2', 'c3', 'cs3', 'd3', 'ds3', 'e3', 'f3', 'fs3', 'g3', 'gs3', 'a3', 'as3', 'b3', 'c4', 'cs4', 'd4', 'ds4', 'e4', 'f4', 'fs4', 'g4', 'gs4', 'a4', 'as4', 'b4', 'c5', 'cs5', 'd5', 'ds5', 'e5', 'f5', 'fs5', 'g5', 'gs5', 'a5', 'as5', 'b5', 'c6', 'cs6', 'd6', 'ds6', 'e6', 'f6', 'fs6', 'g6', 'gs6', 'a6', 'as6', 'b6', 'c7'];
	addon.nbuf = [];
	addon.nbuft = 0;
	addon.debug = false;
	addon.flush = function() {
		if(addon.nbuft && addon.nbuf.length) {
			var abuf = new ArrayBuffer(addon.nbuf.length * 3 + 9),
				dv = new DataView(abuf),
				offs = addon.nbuft + client.serverTimeOffset,
				t1 = offs >> 0,
				t2 = Math.round((offs * Math.pow(2, -32)));
			dv.setUint8(0, 1); /* Message type */
			dv.setInt32(1, t1, true); /* Time, split in two (no setUint64) */
			dv.setInt32(5, t2, true);
			for(var x = addon.nbuf.length; x--;) {
				dv.setUint8(x * 3 + 9, addon.nbuf[x].n);
				dv.setUint8(x * 3 + 9 + 1, addon.nbuf[x].v);
				dv.setUint8(x * 3 + 9 + 2, addon.nbuf[x].d);
			}
			addon.nbuf = [];
			addon.nbuft = 0;
			if(addon.debug)
				console.log("Sent " + dv.byteLength + " bytes.");
			client.ws.send(abuf);
		}
	};
	client.binStartNote = function(n, v) {
		v = v !== undefined ? (v > 1 ? 1 : v < 0 ? 0 : v) : 0.5;
		n = addon.keysarr.indexOf(n);
		if(client.isConnected() && n !== -1) {
			if(!addon.nbuft) {
				addon.nbuft = Date.now();
				addon.nbuf.push({
					n: n,
					v: ~~(v * 255),
					d: 0
				});
			} else {
				var d = Date.now() - addon.nbuft;
				if(d > 255) {
					addon.flush();
					addon.nbuft = Date.now();
					d = 0;
					clearInterval(addon.flushloop);
					addon.flushloop = setInterval(addon.flush, 200);
					console.log("Delay too high, flushed notebuffer!");
				}
				addon.nbuf.push({
					n: n,
					v: ~~(v * 255),
					d: d
				});
			}
		}
	};
	client.binStopNote = function(n) {
		n = addon.keysarr.indexOf(n);
		if(client.isConnected() && n !== -1) {
			if(!addon.nbuft) {
				addon.nbuft = Date.now();
				addon.nbuf.push({
					n: n,
					v: 0,
					d: 0
				});
			} else {
				var d = Date.now() - addon.nbuft;
				if(d > 255) {
					addon.flush();
					addon.nbuft = Date.now();
					d = 0;
					clearInterval(addon.flushloop);
					addon.flushloop = setInterval(addon.flush, 200);
					console.log("Delay too high, flushed notebuffer!");
				}
				addon.nbuf.push({
					n: n,
					v: 0,
					d: d
				});
			}
		}
	};
	return addon;
};

function drawPatch(client) {
	let addon = {};
	addon.buffer = [];
	addon.mkline = function(x, y, x2, y2, thickness, color) {
		// make sure the coords arent out of bounds
		x = Math.floor(Math.max(0, Math.min(255, x)));
		y = Math.floor(Math.max(0, Math.min(255, y)));
		x2 = Math.floor(Math.max(0, Math.min(255, x2)));
		y2 = Math.floor(Math.max(0, Math.min(255, y2)));
		
		// make sure line thickness is valid
		thickness = Math.max(1, Math.min(thickness, 5));
		
		// make sure color is also valid
		let colorInt = parseInt(color.replace("#", ""), 16);
		if(isNaN(colorInt) || colorInt < 0 || 256 ** 6 < colorInt) colorInt = parseInt(client.getOwnParticipant().color.slice(1));
		
		// note message format
		
		// d: color as integer number
		// v: thickness as number
		// n: x, y, x2, y2 converted to ASCII characters in a string
		
		// t: not required, optional to implement but will not have an effect
		
		let note = {
			d: colorInt,
			v: thickness,
			n: [
				x,
				y,
				x2,
				y2
			].map(x => String.fromCharCode(x))
			.join('')
		};
		
		addon.buffer.push(note);
	};
	
	addon.flush = function() {
		addon.buffer.unshift({ n: "ldraw", v: 1 });
		client.sendArray([{
			m: "n",
			n: addon.buffer,
			t: Date.now() + client.serverTimeOffset
		}]);
		addon.buffer = [];
	};
	
	addon.drawJSON = function(object, x, y, width, height, thickness, color) {
		if(typeof object === 'string') object = JSON.parse(object);
		for(let i in object) {
			let xi = object[i];
			// console.log(`(${xi.source.x * width}, ${xi.source.y * height}) -> (${xi.destination.x * width}, ${xi.destination.y * height}) [${JSON.stringify(xi)}]`);
			addon.mkline(
				(xi.source.x * width) + x,
				(xi.source.y * height) + y,
				(xi.destination.x * width) + x,
				(xi.destination.y * height) + y,
				thickness || xi.thickness,
				color || xi.color
			);
		};
	};
	
	return addon;
};
