//go:build js && wasm

// A YaNFD forwarder in a JavaScript runtime (browser or Node), with faces bridged to JS.
package main

import (
	"syscall/js"
	"time"

	"github.com/named-data/ndnd/fw/core"
	"github.com/named-data/ndnd/fw/dispatch"
	"github.com/named-data/ndnd/fw/face"
	"github.com/named-data/ndnd/fw/fw"
	"github.com/named-data/ndnd/fw/table"
	enc "github.com/named-data/ndnd/std/encoding"
)

func main() {
	cfg := core.DefaultConfig()
	cfg.Core.LogLevel = "WARN"
	cfg.Faces.Udp.EnabledUnicast = false
	cfg.Faces.Udp.EnabledMulticast = false
	cfg.Faces.Tcp.Enabled = false
	cfg.Faces.Unix.Enabled = false
	cfg.Faces.WebSocket.Enabled = false
	cfg.Faces.HTTP3.Enabled = false
	cfg.Fw.Threads = 1

	core.C = cfg
	core.StartTimestamp = time.Now()
	core.OpenLogger()
	face.Initialize()
	table.Initialize()
	face.MakeNullLinkService(face.MakeNullTransport()).Run(nil)
	fw.Threads = make([]*fw.Thread, 1)
	fw.Threads[0] = fw.NewThread(0)
	go fw.Threads[0].Run()
	dispatch.InitializeFWThreads([]dispatch.FWThread{fw.Threads[0]})

	api := js.Global().Get("Object").New()
	api.Set("addFace", js.FuncOf(func(this js.Value, args []js.Value) any {
		cb := args[0]
		t := face.MakeJSTransport(func(b []byte) {
			u := js.Global().Get("Uint8Array").New(len(b))
			js.CopyBytesToJS(u, b)
			cb.Invoke(u)
		})
		link := face.MakeNDNLPLinkService(t, face.MakeNDNLPLinkServiceOptions())
		link.Run(nil)
		return float64(link.FaceID())
	}))
	api.Set("send", js.FuncOf(func(this js.Value, args []js.Value) any {
		b := make([]byte, args[1].Get("length").Int())
		js.CopyBytesToGo(b, args[1])
		return face.JSTransportDeliver(uint64(args[0].Int()), b)
	}))
	api.Set("route", js.FuncOf(func(this js.Value, args []js.Value) any {
		name, err := enc.NameFromStr(args[0].String())
		if err != nil {
			return err.Error()
		}
		table.FibStrategyTable.InsertNextHopEnc(name, uint64(args[1].Int()), 0)
		return nil
	}))
	// exit ends main, so Go's runtime stops and the page can let go of this instance's memory.
	done := make(chan struct{})
	api.Set("exit", js.FuncOf(func(this js.Value, args []js.Value) any {
		select {
		case <-done:
		default:
			close(done)
		}
		return nil
	}))
	js.Global().Set("yanfd", api)
	if r := js.Global().Get("onYanfdReady"); r.Type() == js.TypeFunction {
		r.Invoke()
	}
	<-done
}
