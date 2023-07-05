import initSignal from 'simple-peer-light'
import { nanoid } from 'nanoid'
import {EventEmitter} from 'events'
import {enc, SHA1} from 'crypto-js'
import {hex2bin, bin2hex} from 'uint8-util'

export class Room extends EventEmitter {
    constructor(room, maxLimit, stayLimit, opts = {}){
      super()
      this.timer = (opts.timer || 30) * 1000
      this.offers = {}
      this.sockets = {}
      this.signals = {}
      this.selfId = SHA1(nanoid()).toString(enc.Hex)
      this.rtcConfig = opts.rtcConfig || {}
      this.trackerAction = 'announce'
      this.trackerUrls = opts.trackers || ['wss://fediverse.tv/tracker/socket','wss://tracker.files.fm:7073/announce','wss://tracker.openwebtorrent.com']
      if (!this.trackerUrls.length) {
          throw new Error('trackerUrls is empty')
      }
      this.hash = SHA1(room).toString(enc.Hex)
      this.maxLimit = typeof(maxLimit) === 'number' ? maxLimit : 5
      this.stayLimit = typeof(stayLimit) === 'boolean' ? stayLimit : false
      this.signalCount = 0
      this.sessions = 0
      // this.loadsignals(null).then((count) => {this.emit('count', count)}).catch((err) => {this.emit('error', err)})
      this.recheck = opts.recheck || null
      this.recheckTimer = (opts.recheckTimer || 30) * 1000
      this.statusConnections().then((data) => {this.emit('count', data);}).catch((err) => {this.emit('error', err)})
      // this.interval = setInterval(() => {this.loadSignals().then((count) => {this.emit('count', count)}).catch((err) => {this.emit('error', err)})}, this.timer)
    }
    async getArr(howMany, signalArgs){
      console.log('making ' + howMany + ' signals')
      for(let i = 0;i < howMany;i++){
        const id = SHA1(nanoid()).toString(enc.Hex)
        const peer = new initSignal(signalArgs)
        this.signalCount++
        peer.offer = id
        peer.runFunc = true
        peer.on('error', (err) => {
          peer.destroy()
          this.emit('error', err)
        })
        peer.on('close', () => {
          if(peer.reCheck){
            clearInterval(peer.reCheck)
          }
          if(peer.id){
            if(this.signals[peer.id]){
              delete this.signals[peer.id]
            }
          }
          if(peer.offer){
            if(this.offers[peer.offer]){
              delete this.offers[peer.offer]
            }
          }
          this.signalCount--
          this.emit('close', peer.id)

          if(peer.runFunc){
            this.statusConnections().then((data) => {this.emit('count', data);}).catch((err) => {this.emit('error', err)})
          }
        }
        )
        const stamp = Date.now()
        // peer.offer = id
        this.offers[id] = {stamp, id, offer_id: id, peer, offer: await new Promise((resolve) => peer.once('signal', resolve))}
      }
      console.log('made ' + howMany + ' signals')
    }
    async statusConnections(){
      if(this.signalCount === this.maxLimit){
        this.sessions = this.maxLimit
        return this.sessions
      }
      if(this.signalCount > this.maxLimit){
        this.sessions = this.maxLimit - this.signalCount
        const useNum = Math.abs(this.sessions)
        const arrOfOffers = Object.keys(this.offers)
        if(arrOfOffers.length > useNum){
          for(const useIndex of arrOfOffers.slice(arrOfOffers.length - useNum)){
            this.offers[useIndex].peer.runFunc = false
            this.offers[useIndex].peer.destroy()
          }
        } else {
          for(const useProp in this.offers){
            this.offers[useProp].peer.runFunc = false
            this.offers[useProp].peer.destroy()
          }
        }
        return this.sessions
      }

      if(this.stayLimit || this.signalCount === 0){
        const self = this

        await this.getArr(this.sessions, {initiator: true, trickle: false, config: {}})

        for(const url of this.trackerUrls){
          let socketUrl = this.sockets[url]
          if(!socketUrl){
            socketUrl = new WebSocket(url)
            try {
              await new Promise((res, rej) => {
                socketUrl.onopen = function(e){
                  console.log(e)
                  self.sockets[url] = socketUrl
                  // self.emit('socket-open', url)
                  res()
                }
                socketUrl.onerror = function(e){
                  console.error(e)
                  socketUrl.close()
                }
                socketUrl.onmessage = function(e){
                  let val
      
                  try {
                    val = JSON.parse(e.data)
                    console.log(val)
                  } catch (e) {
                    console.error(`Trystero: received malformed SDP JSON`)
                    return
                  }
          
                  if(!val.offer_id || !val.peer_id || !val.info_hash){
                    return
                  }
      
                  val.info_hash = bin2hex(val.info_hash)
                  val.peer_id = bin2hex(val.peer_id)
          
                  if(val.peer_id === self.selfId){
                    return
                  }
          
                  if(self.signals[val.peer_id]){
                    return
                  }
              
                  if (val.info_hash !== self.hash){
                    return
                  }
              
                  const failure = val['failure reason']
              
                  if (failure) {
                    console.error(`Trystero: torrent tracker failure (${failure})`)
                    return
                  }
              
                  // if (val.interval) {
                  //   clearInterval(socketUrl.interval)
                  //   socketUrl.timer = val.interval
                  //   socketUrl.interval = setInterval(() => {self.loadSignals(url).then((count) => {self.emit('count', count)}).catch((err) => {self.emit('error', err)})}, socketUrl.timer * 1000)
                  // } else {
                  //   clearInterval(socketUrl.interval)
                  //   socketUrl.timer = self.timer
                  //   socketUrl.interval = setInterval(() => {self.loadSignals(url).then((count) => {self.emit('count', count)}).catch((err) => {self.emit('error', err)})}, socketUrl.timer * 1000)
                  // }
              
                  if (val.offer) {
                    if(self.signalCount >= self.maxLimit){
                      if(Object.keys(self.offers).length){
                        const testProp = (() => {const testArr = self.shuffle(Object.keys(self.offers));return testArr[Math.floor(Math.random() * testArr.length)];})()
                        self.offers[testProp].peer.runFunc = false
                        self.offers[testProp].peer.destroy()
                      } else {
                        return
                      }
                    }
          
                    const peer = new initSignal({initiator: false, trickle: false, config: self.rtcConfig})
                    self.signalCount++
  
                    peer.runFunc = true
                    peer.once('signal', (answer) => {
                      socketUrl.send(
                        JSON.stringify({
                          answer,
                          action: self.trackerAction,
                          info_hash: hex2bin(self.hash),
                          peer_id: hex2bin(self.selfId),
                          to_peer_id: hex2bin(val.peer_id),
                          offer_id: val.offer_id
                        })
                      )
                    })
                    peer.on('error', (err) => {
                      peer.destroy()
                      self.emit('error', err)
                    })
                    peer.on('connect', () => {
                      if(self.recheck){
                        peer.reCheck = setInterval(() => {self.recheck(peer)}, self.recheckTimer)
                      }
                      peer.id = val.peer_id
                      peer.offer = val.offer_id
                      self.signals[peer.id] = peer
                      delete self.offers[peer.offer]
                      self.emit('connect', peer.id)
                    })
                    peer.on('close', () => {
                      if(peer.reCheck){
                        clearInterval(peer.reCheck)
                      }
                      if(peer.id){
                        if(self.signals[peer.id]){
                          delete self.signals[peer.id]
                        }
                      }
                      if(peer.offer){
                        if(self.offers[peer.offer]){
                          delete self.offers[peer.offer]
                        }
                      }
                      self.signalCount--
                      self.emit('close', peer.id)
  
                      if(peer.runFunc){
                        this.statusConnections().then((data) => {this.emit('count', data);}).catch((err) => {this.emit('error', err)})
                      }
                    })
                    peer.signal(val.offer)
              
                    return
                  }
              
                  if (val.answer) {
                    if(!self.offers[val.offer_id]){
                      return
                    }
                    if(self.signalCount >= self.maxLimit){
                      if(Object.keys(self.offers).length){
                        const testProp = (() => {const testArr = self.shuffle(Object.keys(self.offers));return testArr[Math.floor(Math.random() * testArr.length)];})()
                        self.offers[testProp].peer.runFunc = false
                        self.offers[testProp].peer.destroy()
                      } else {
                        return
                      }
                    }
              
                    const {peer} = self.offers[val.offer_id]
      
                    if(peer.offer !== val.offer_id){
                      peer.destroy()
                    }
              
                    if (peer.destroyed) {
                      return
                    }
                    peer.on('connect', () => {
                      if(self.recheck){
                        peer.reCheck = setInterval(() => {self.recheck(peer)}, self.recheckTimer)
                      }
                      peer.id = val.peer_id
                      peer.offer = val.offer_id
                      self.signals[peer.id] = peer
                      delete self.offers[peer.offer]
                      self.emit('connect', peer.id)
                    }
                    )
                    peer.signal(val.answer)
                  }
                }
                socketUrl.onclose = function(){
                  socketUrl.onopen = undefined
                  socketUrl.onerror = undefined
                  socketUrl.onmessage = undefined
                  socketUrl.onclose = undefined
                  delete self.sockets[url]
                  rej()
                }
              })
            } catch (error) {
              console.error(error)
              continue
            }
          }
          if(socketUrl.readyState === WebSocket.OPEN){
            socketUrl.send(JSON.stringify({
              action: this.trackerAction,
              info_hash: hex2bin(this.hash),
              numwant: this.sessions,
              peer_id: hex2bin(this.selfId),
              offers: (() => {
                const offers = []
                for(const test in this.offers){
                  offers.push({offer_id: this.offers[test].offer_id, offer: this.offers[test].offer})
                }
                return offers
              })()
            }))
          }
        }
        return this.sessions
      } else {
        return this.sessions
      }
    }
    // socketMessageEvent(e){}
    shuffle(array) {
      let currentIndex = array.length,  randomIndex;
    
      // While there remain elements to shuffle.
      while (currentIndex != 0) {
    
        // Pick a remaining element.
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
    
        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [
          array[randomIndex], array[currentIndex]];
      }
    
      return array;
    }
      // takeOutEvents(socket){
      //   socket.onopen = undefined
      //   socket.onerror = undefined
      //   socket.onmessage = undefined
      //   socket.onclose = undefined
      // }
}