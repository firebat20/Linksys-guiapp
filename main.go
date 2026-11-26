package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	service := NewLinksysService()

	app := application.New(application.Options{
		Name:        "Linksys Router Manager",
		Description: "Linksys Smart Wi-Fi Router Manager",
		Services: []application.Service{
			application.NewService(service),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "Linksys Router Manager",
		Width:            1080,
		Height:           760,
		MinWidth:         900,
		MinHeight:        640,
		BackgroundColour: application.NewRGBA(15, 23, 42, 255),
		Windows: application.WindowsWindow{
			Theme: application.Dark,
		},
	})

	err := app.Run()
	if err != nil {
		log.Fatal("Error: ", err)
	}
}
