//go:build js && wasm

package face

import (
	"fmt"
	"sync"

	defn "github.com/named-data/ndnd/fw/defn"
	spec_mgmt "github.com/named-data/ndnd/std/ndn/mgmt_2022"
)

// JSTransport carries NDN-LP frames between the forwarder and JavaScript (proof of concept).
type JSTransport struct {
	transportBase
	out func([]byte)
	in  chan []byte
}

var jsTransports sync.Map

func MakeJSTransport(out func([]byte)) *JSTransport {
	t := new(JSTransport)
	t.makeTransportBase(defn.MakeNullFaceURI(), defn.MakeNullFaceURI(),
		spec_mgmt.PersistencyPersistent, defn.NonLocal, defn.PointToPoint, defn.MaxNDNPacketSize)
	t.out = out
	t.in = make(chan []byte, 4096)
	t.running.Store(true)
	return t
}

func (t *JSTransport) String() string { return fmt.Sprintf("js-transport (faceid=%d)", t.faceID) }
func (t *JSTransport) SetPersistency(p spec_mgmt.Persistency) bool {
	t.persistency = p
	return true
}
func (t *JSTransport) GetSendQueueSize() uint64 { return 0 }

func (t *JSTransport) sendFrame(frame []byte) {
	if !t.running.Load() {
		return
	}
	t.nOutBytes += uint64(len(frame))
	c := make([]byte, len(frame))
	copy(c, frame)
	t.out(c)
}

func (t *JSTransport) runReceive() {
	jsTransports.Store(t.faceID, t)
	for frame := range t.in {
		t.nInBytes += uint64(len(frame))
		t.linkService.handleIncomingFrame(frame)
	}
}

func (t *JSTransport) Close() {
	if t.running.Swap(false) {
		close(t.in)
	}
}

// JSTransportDeliver hands a frame from JavaScript to the face with this id.
func JSTransportDeliver(id uint64, b []byte) bool {
	v, ok := jsTransports.Load(id)
	if !ok {
		return false
	}
	select {
	case v.(*JSTransport).in <- b:
		return true
	default:
		return false
	}
}
