# OCC Oscilloscope

A browser **demonstrator for Optical Camera Communications (OCC)**. It turns any device
camera (webcam, front, or back phone cameras) into an optical receiver and plots pixel
intensities like an oscilloscope, in real time.

![mode: global / rolling shutter](https://img.shields.io/badge/OCC-global%20%7C%20rolling-38bdf8)

## Features

- **Camera selection** — every available `videoinput` device is listed in a menu at start-up
  (webcam, front, and back cameras).
- **Sensor control** — manual **exposure time** and **ISO/gain** via `MediaStreamTrack`
  capabilities, so the optical signal is not washed out by auto-exposure. The effect is
  visible live in the video stream (where the camera/browser expose these controls).
- **Top section** — the video stream and the oscilloscope plot side by side (stacked on
  portrait phones), both kept on screen.
- **Two OCC acquisition modes:**

  ### Global shutter
  Every pixel is exposed at once, so one frame yields one sample. Pick a **Pixel of Interest
  (POI)** with the `X`/`Y` sliders (or click the video). A **radius** slider grows it into a
  circular **Region of Interest (ROI)** that is averaged. The averaged **R, G, B** values are
  streamed over time → *oscilloscope = intensity vs. frame*.

  ### Rolling shutter
  Rows/columns are read out sequentially, so a single frame already contains a time-modulated
  signal along the **scanning direction**. Choose **Vertical (Y)** or **Horizontal (X)** —
  whichever matches the selected camera's readout — and the **R, G, B** profile along it is
  plotted → *oscilloscope = intensity vs. position*. An optional rectangular **ROI**
  (`x1,y1,x2,y2`) averages across the perpendicular axis to reduce noise.

- **Freeze**, **Clear**, and **CSV export** of the current trace.

## Running it

A camera requires a **secure context**: `https://` or `localhost`.

```bash
# any static server works, e.g.
python -m http.server 8000
# then open http://localhost:8000
```

For testing on a **phone**, serve over HTTPS (self-signed certificate, a tunnel such as
`ngrok`, or **GitHub Pages**, which provides HTTPS for free).

> Manual exposure / ISO support depends on the camera and browser. Chrome on Android exposes
> the most controls; many laptop webcams and iOS Safari expose few or none — the app detects
> this and labels the controls accordingly.

## License

Copyright © 2026 **Dr. Vicente Matus, PhD** —
[github.com/inventor-loco](https://github.com/inventor-loco),
IDeTIC, University of Las Palmas de Gran Canaria
([idetic.ulpgc.es](https://idetic.ulpgc.es/)).

Released under the **GNU General Public License v3** — see [LICENSE](LICENSE).
