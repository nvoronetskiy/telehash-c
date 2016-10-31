'use strict';
const EventEmitter = require("events").EventEmitter;
const lob = require("lob-enc");
//const hashname = require("hashname");
//const base32 = require("base32")
const path = require("path");
const Duplex = require("stream").Duplex;

const th = require("./include/");
//th.util_sys_logging(1);
const lob_to_c = (buf) => typeof buf === "number" ? buf : lob_parse(buf, buf.length)

const lob_from_c = (ptr) => lob.decode(buf_lob_from_c(ptr))

const buf_lob_from_c = (ptr) => th.BUFFER(lob_raw(ptr),lob_len(ptr))

const hex_to_lob = (hex) => {
  let k = new Buffer(hex, "hex");
  return lob_parse(k, k.length);
}





class Chunks{
  constructor(Mesh, stream, chunk_size){
    var mesh = Mesh._mesh;
    var link;
    var linked = false;
    var that = this;
    //console.log("chunks", chunk_size)
    this.chunks = lob.chunking({size:chunk_size, blocking: true}, function receive(err, packet){
      //console.log("got chunk packet")
      if(err || !packet)
      {
        //console.error('pipe chunk read error',err,pipe.id);
        return;
      }
      link = mesh_receive(mesh,lob_to_c(packet))
      if (!linked && link){
        //console.log("linked")
        mesh_link(mesh, link);
        that._c_link = link;

        linked = true;
        link_pipe(link, function(link, packet, arg){
          if(!packet) return null;
          that.chunks.send(lob_from_c(packet));
          return link;
        },null);
        stream.on('close', () => {
          let l = Mesh._links.get(th.UTF8ToString( hashname_char(link_id(link)) ).substr(0,8))
          if (l)
            l.emit('down')
          else {
            console.log("UNDEF",th.UTF8ToString( hashname_char(link_id(link)) ).substr(0,8) )
          }
        })
        stream.on('end', () => {
          let l = Mesh._links.get(th.UTF8ToString( hashname_char(link_id(link)) ).substr(0,8))
          if (l)
            l.emit('down')
          else {
            console.log("UNDEF",th.UTF8ToString( hashname_char(link_id(link)) ).substr(0,8) )
          }
        })
      }


    });

    var datas = [];
    var flushing = false;
    function flush(){
      if (!flushing && datas.length){
        flushing = true;
        stream.write(datas.shift(),function(err){
          //console.log("write done");
          if(err) return console.error(err);
          stream.drain((err) => {
            //console.log("Drain done")
            flushing = false;
            if (err) return console.error(err);
            setTimeout(flush,1);
          })
          //setTimeout(frames_flush,1); // unroll
        });
      }

    }


    stream.pipe(this.chunks)
    this.chunks.on('data', (d) =>{
      datas.push(d);
      flush();
    })
    var greeting = lob_from_c(mesh_json(mesh));
    this.chunks.send(lob.encode(greeting.json));

  }

  cleanup(Mesh, c_link){
    if (c_link === this._c_link){
      //console.log("calling cleanup on chunk")
      //this.stream.close();
      return true;
    } else {
      return false
    }
  }
}

class Frames{
  constructor (Mesh, stream, frame_size){
    var mesh = Mesh._mesh;
    this.frames = util_frames_new(frame_size);
    var frames = this.frames;
    var flushing = false;
    var that = this;
    function frames_flush()
    {
      if(!util_frames_pending(frames)) return;
      if(flushing) return;
      flushing = true;
      let frame = th._malloc(frame_size);
      util_frames_outbox(frames,frame,null);
      util_frames_sent(frames);
//      console.log("sending frame",th.BUFFER(frame,frame_size).toString("hex"));
      stream.write(th.BUFFER(frame,frame_size),function(err){

        //console.log("write done");
        if(err) return console.error(err);
        flushing = false;
        if (err) return console.error(err);
        setTimeout(frames_flush,1);
        //setTimeout(frames_flush,1); // unroll
      });
      th._free(frame);
    }

    var linked;
    var readbuf = new Buffer(0);

    stream.on('data',function(data){
      // buffer up and look for full frames
      readbuf = Buffer.concat([readbuf,data]);
//      console.log('data',readbuf.length,data.length);
      while(readbuf.length >= frame_size)
      {
        // TODO, frames may get offset, need to realign against whatever's in the buffer
        //th.util_sys_logging(1);
        var frame = readbuf.slice(0,frame_size);
        readbuf = readbuf.slice(frame_size);
        util_frames_inbox(frames,frame,null);
        if(!util_frames_ok(frames))
        {
          //console.log("frames state error, resetting");
          util_frames_clear(frames);
        }else{
//          console.log("receive frame",frame.toString("hex"));
        }
      }
      frames_flush();
      // check for and process any full packets
      var packet;
      while((packet = util_frames_receive(frames)))
      {
        //console.log("got packet")
        //th.util_sys_logging(1);
        var link = mesh_receive(mesh,packet);
        if(linked || !link) continue;

        console.log("FRAMES LINKING")
        that._c_link = link;
        mesh_link(mesh, link);


        // catch new link and plumb delivery pipe
        linked = link;
        link_pipe(link, function(link, packet, arg){

          if(!packet) return null;
          //console.log("sending packet", frames, packet, lob_len(packet));
          util_frames_send(frames,packet)
          frames_flush()
          return link;
        },null);

      }
    });

    stream.on('close', () => {
      console.log("frames stream closed");
      flushing = false;
      if (linked){
        let l = Mesh._links.get(th.UTF8ToString( hashname_char(link_id(linked)) ).substr(0,8))
        if (l)
          l.emit('down')
        else {
          console.log("UNDEF",th.UTF8ToString( hashname_char(link_id(linked)) ).substr(0,8) )
        }
      }
    })

    mesh_on_discover(Mesh._mesh, "aaa", (mesh, discovered, pipe) => {

      let packet = lob_from_c(discovered)
      let hashname = packet.json.hashname;
      if (Mesh._reject.has(hashname)) return null;
      if (Mesh._open || Mesh._accept.has(hashname)) return null; //will get handled by global CB

      process.nextTick(() => {

        let link = mesh_add(mesh, discovered, pipe);
        if (!linked && link){
          that._c_link = link;
          mesh_link(mesh, link);


          // catch new link and plumb delivery pipe
          linked = link;
          link_pipe(link, function(link, packet, arg){
            if(!packet) return null;
            //console.log("sending packet", frames, packet, lob_len(packet));
            util_frames_send(frames,packet)
            frames_flush()
            return link;
          },null);
        }
        return link;
      })

    })

    util_frames_send(frames,mesh_json(mesh));
    frames_flush();

  }


  cleanup(Mesh, c_link){
    if (c_link === this._c_link){
      this.stream.close();
      return true;
    } else {
      return false;
    }
  }

}

class Channel extends Duplex{
  constructor(c_mesh, c_link, open){
    super({objectMode : true});
    let buf = lob.encode(open.json, new Buffer(open.body || 0));
    let c_lob = lob_to_c(buf);

    this._c_mesh = c_mesh;

    this._c_chan = link_chan(c_link, c_lob);

    this._open = c_lob;

    chan_handle(this._c_chan, () => {
      let c_lob;
      while(c_lob = chan_receiving(this._c_chan)) {
        let lob = lob_from_c(c_lob);
        //console.log("LOB", lob)
        if (lob)
          this.push(lob);
        else
          console.log("bad lob",buf_lob_from_c(c_lob).toString())

      }
    }, null);

    this.on('data',(packet) => {
      this.receiving(null, packet, () => {});
    })
  }

  receiving(er, packet, cbChan){
    //console.log("RECIEVING??????")
  }

  send(packet){
    this.write(packet);
  }

  c_send(c_lob){
    chan_send( this._c_chan, c_lob );
  }

  _write(packet, enc, cb){
    packet.json.c = chan_id(this._c_chan);
    this.c_send(lob_to_c(lob.encode(packet.json, packet.body)));
    cb();
  }

  _read(size){
    //console.log("_READ")
  }
}

class Link extends EventEmitter {
  constructor(Mesh, c_link){
    super();

    this._c_mesh = Mesh._mesh;
    this.mesh = Mesh;
    this._c_link = c_link;
    this.hashname = th.UTF8ToString( hashname_char(link_id(c_link)) );
    var id = this.hashname.substr(0,8)

    Mesh._links.set(id, this);
    this.on('down',() => {
      Mesh._links.delete(id)
      Mesh._deadLinks.set(id, this);
      try{
        link_pipe(c_link, null, null);
        link_down(c_link);
        link_free(c_link);
      } catch (e){}
    })
    this.x = {
      channel : this.channel
    }
  }

  get up(){
    return link_up(this._c_link);
  }

  direct(open, body){
    let buf = lob.encode(open, new Buffer(body));
    link_direct( this._c_link, lob_to_c(buf) );
  }

  c_link(c){
    this._c_link = c;
  }

  init(file, cb){
    let chan = this.channel({json : {type: "init"} , body : file})
    chan.on('data',(packet) => cb(null, packet.json))
    chan.c_send(chan._open);
  }

  channel(open){
    return new Channel( this._c_mesh, this._c_link, open);
  }

  disconnect(){
    for (let [type, transport] of this.mesh._transports){
      if (type === this._transport.type) return transport.disconnect(this._transport.handle, this._transport.pipe)
    }
    return Promise.reject(new Error(`link disconnect found no transport for type ${this._transport.type}`))
  }

  console(cmd, cb){
    let chan = this.channel({json : {type : "console"}, body : cmd})
    chan.on('data',(packet) => {
      let result;

      try {
        result = JSON.parse(packet.body.toString());
      } catch (e){
        result = packet.body.length ? packet.body.toString() : null;
      }

      cb(null, Object.assign(packet.json, {result: result}))
    })
    chan.c_send(chan._open);
  }

  close(){
    Mesh._frames.forEach((frames) => frames.cleanup(Mesh, c_link) && Mesh._frames.delete(frames))
    Mesh._chunks.forEach((chunks) => chunks.cleanup(Mesh, c_link) && Mesh._frames.delete(chunks))
  }
}

class Mesh extends EventEmitter {
  constructor(on_up, opts){
    super();
    this._mesh = mesh_new();
    this._opts = opts;

    this._accept = new Set();
    this._reject = new Set();
    this._links = new Map();
    this._deadLinks = new Map();

    this._frames = new Set();
    this._chunks = new Set();
    this._listen = new Set();
    this._connect = new Map();

    this._transports = new Map();
    this._parsers = new Array();
    this._discovered = new Map();

    this.once("up",on_up);
  }

  get _open() {
    return ((this._accept.size === 0) && (this.listenerCount('discover') === 0));
  }

  frames(transport, frame_size){
    this._frames.add(new Frames(this, transport, frame_size));
    return transport;
  }

  chunks(transport, chunk_size){
    this._chunks.add(new Chunks(this, transport, chunk_size));
    return transport;
  }

  init(on_link, opts){

  }

  link(json){

  }

  accept(hashname){
    this._accept.add(hashname);
  }

  reject(hashname){
    this._reject.add(hashname);
  }

  listen(){
    let promise = [];
    for (let listen of this._listen) promise.push(listen());
    Promise.all(promise).then((aborts) => (this._aborts = aborts) && this.emit('up', this)).catch((e) => this.emit('error', e))
  }

  start(listen){
    this._mesh = mesh_new();

    this.on('open',(link, packet) => {
      try {
        if (this._parsers.length > 0){
          this._parsers.reduce((promise, parser) => {
            parser.log.trace("parser", parser.name);
            return promise.catch(() => parser.process(link,packet).then((evt) => {
              if (!evt.data) return Promise.reject(new Error('no data'))
              return evt;
            }))
          }, Promise.reject())
          .then((evt) => {
            this.emit('data',evt)
          })
          .catch(e => {
            console.error("error",e);
          });
        }
      } catch (e) {
        console.error("!!!!!! PARSER ERROR BUBBLED OUT TO THC. DANGER WILL ROBINSON !!!!!!")
      }
    })

    for( let [type, transport] of this._transports){
      console.log("starting transport",type);
      transport.enable(this).catch((e) => this.emit('error',e))
    }


    mesh_on_link(this._mesh, "*", (c_link) => {

      let id = th.UTF8ToString( hashname_char(link_id(c_link)) ).substr(0,8);
      console.log("C MESH GOT LINK", id)
      if (link_up(c_link) && !this._links.has(id)){
        let _link = this._deadLinks.get(id);
        var no_emit = false;
        if (_link) {
          no_emit = true;
        }
        _link = _link || new Link(this , c_link);
        _link.c_link(c_link);
        process.nextTick(() => {
          this._links.set(id, _link);
          if (!no_emit) this.emit("link", _link)
          _link.emit("up");
        });
      }
      if (!link_up(c_link) && this._links.has(id)){
        this._deadLinks.set(id, this._links.get(id))
        this._links.delete(id)
      }
      if (link_up(c_link) && this._links.has(id)){
        let _link = this._links.get(id);
        _link.emit('up')
      }
    });

    mesh_on_open(this._mesh, "*", (c_link, c_open) => {
      var link = this._links.get( th.UTF8ToString( hashname_char(link_id(c_link)) ).substr(0,8) )
      var packet = lob_from_c(c_open);

      //TODO: deprecate;
      process.nextTick(() => {
        this.emit('open', link , packet );
      })


    });

    this._getKeys((secrets, keys) => {
      if (secrets && keys){
        mesh_load(this._mesh,  hex_to_lob(secrets),hex_to_lob(keys))

      } else {
        let secrets = mesh_generate(this._mesh)
        if (!secrets) throw new Error("mesh generate failed");

        this._storeKeys( buf_lob_from_c(secrets).toString("hex"), buf_lob_from_c(lob_linked(secrets)).toString("hex"), () => {

        })
      }
      this.hashname = th.UTF8ToString( hashname_char(mesh_id(this._mesh)));
      //if (listen) //this.listen();
      //else
      this.emit('up',this)
    })
  }

  stopListen(){
    this._aborts = this._aborts.filter((abort) => abort() && false)
  }

  _getKeys(cb){
    let TELEHASH_SECRET_KEYS = process.env.TELEHASH_SECRET_KEYS
      , TELEHASH_PUBLIC_KEYS = process.env.TELEHASH_PUBLIC_KEYS;
    cb( TELEHASH_SECRET_KEYS, TELEHASH_PUBLIC_KEYS )
  }

  _storeKeys(secrets, keys, cb){
    cb()
    // this function intentionally left blank
  }

  connect(evt){
    var evt = this._discovered.get(evt.id) || evt;

    var {type, handle, id} = evt;

    if (!this._transports.has(type)) return Promise.reject(new Error('no transport for type'))

    let transport = this._transports.get(type);

    return transport
           .connect(handle)
           .then((pipe) => {
             transport.log.info(`got ${transport.type} pipe for ${id}`);
             if (pipe.chunk_size) return Promise.resolve(this.chunks(pipe, pipe.chunk_size));
             if (pipe.frame_size) return Promise.resolve(this.frames(pipe, pipe.frame_size));
             return Promise.reject(new Error('unknown framing protocol, did you forget to set frame_size getter?'));
           })
           .then((pipe) => new Promise((resolve, reject) => {
             const linkIDChecker = (link) => {
               link.id = link.hashname.substr(0,8);
               if (link.id === id) {
                 this.removeListener('link', linkIDChecker);
                 link._transport = {type, handle, pipe};
                 resolve(link)
               }
             }
             this.on('link',linkIDChecker);
           }))
  }

  discovered(){
    var ret = []
    for (let [id, evt] of this._discovered){
      ret.push(evt);
    }
    return ret;
  }

  clearDiscovered(){
    this._discovered.clear();
    for (let [name, transport] of this._transports){
      transport._discovered = {};
    }
  }

  use(mid){
    switch (mid.type){
      case "transport":
        mid.log.info(`got thing`)
        if (mid.listen) this._listen.add(mid.listen);
        if (mid.connect) this._connect.set(mid.name, mid.connect);
        this._transports.set(mid.name, mid);
        mid.on('discover',(handle, id) => {
          mid.log.info(`discover : ${id}`);
          if (!id) return mid.log.warn("discarding discovery with no id");
          if (this._deadLinks.has(id)) {
            return this.connect({type : mid.name, id, handle})
          }
          let emit = !this._discovered.has(id);
          this._discovered.set(id, {type : mid.name, id, handle})

          if (emit) {
            console.log("MESH EMITTING DISCOVERY", id, mid.name);
            this.emit('discover', {type : mid.name, id, handle});
          }
        })
        return;
      case "util":
        return mid.enable(this);
      case "channel":
        return this.on('open', mid.open.bind(this) );
      case "keystore":
        this._getKeys = mid.getKeys;
        this._storeKeys = mid.storeKeys;
        return;
      case "rng":
        e3x_random(th.Runtime.addFunction(mid.randomByte));
        return;
      case "parser":
        if (this._parsers.map(({name}) => name).indexOf(mid.name) < 0) this._parsers.push(mid);
        mid.once('error',() => {
          mid.log.error(e);
          this._parsers = this._parsers.filter((p) => p.name != mid.name);
          mid.disable();
        })
        mid.enable(this);
        return;
      default:
        return;
    }
  }
}



const defaultOpts = {
  id : "./mesh.hashname",
  chan :[],
  transport : []
}

const Telehash = module.exports = (on_up, opts) => {
  if (!on_up){
    throw new Error("must provide an on_link handler");
  }

  opts = Object.assign({}, defaultOpts, opts || {});

  return new Mesh(on_up, opts)
}

Telehash.Mesh = Mesh;
Telehash.Link = Link;
Telehash.Channel = Channel;
