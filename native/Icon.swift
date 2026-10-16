import AppKit

// Render the same vector mark at every macOS icon size, including Retina sizes.
let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
                                      bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                      isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        let context = NSGraphicsContext(bitmapImageRep: bitmap)!.cgContext
        context.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)
        context.setFillColor(NSColor.black.cgColor)
        context.addPath(CGPath(roundedRect: CGRect(x: 80, y: 80, width: 864, height: 864),
                               cornerWidth: 184, cornerHeight: 184, transform: nil))
        context.fillPath()

        // Three visible cube faces, matching the viewer's wireframe controls.
        context.setStrokeColor(NSColor.white.cgColor)
        context.setLineWidth(36)
        context.setLineCap(.round)
        context.setLineJoin(.round)
        context.move(to: CGPoint(x: 512, y: 776))
        for point in [CGPoint(x: 740, y: 644), CGPoint(x: 740, y: 380),
                      CGPoint(x: 512, y: 248), CGPoint(x: 284, y: 380), CGPoint(x: 284, y: 644)] {
            context.addLine(to: point)
        }
        context.closePath()
        context.move(to: CGPoint(x: 284, y: 644))
        context.addLine(to: CGPoint(x: 512, y: 512))
        context.addLine(to: CGPoint(x: 740, y: 644))
        context.move(to: CGPoint(x: 512, y: 512))
        context.addLine(to: CGPoint(x: 512, y: 248))
        context.strokePath()

        let suffix = scale == 2 ? "@2x" : ""
        let file = output.appendingPathComponent("icon_\(size)x\(size)\(suffix).png")
        try bitmap.representation(using: .png, properties: [:])!.write(to: file)
    }
}
