import Foundation
import CoreGraphics

let args = CommandLine.arguments
guard args.count >= 2 else {
    print("Usage: input-actions <action> [params...]")
    print("  click <x> <y>")
    print("  doubleclick <x> <y>")
    print("  rightclick <x> <y>")
    print("  type <text>")
    print("  key <keyname>")
    print("  scroll <dx> <dy>")
    exit(1)
}

let action = args[1]

func click(at point: CGPoint, button: CGMouseButton = .left, clicks: Int = 1) {
    let moveEvent = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                            mouseCursorPosition: point, mouseButton: button)
    moveEvent?.post(tap: .cghidEventTap)
    usleep(30000)

    let downType: CGEventType = button == .left ? .leftMouseDown : .rightMouseDown
    let upType: CGEventType = button == .left ? .leftMouseUp : .rightMouseUp

    for i in 0..<clicks {
        CGEvent(mouseEventSource: nil, mouseType: downType,
                mouseCursorPosition: point, mouseButton: button)?.post(tap: .cghidEventTap)
        usleep(50000)
        CGEvent(mouseEventSource: nil, mouseType: upType,
                mouseCursorPosition: point, mouseButton: button)?.post(tap: .cghidEventTap)
        if i < clicks - 1 { usleep(200000) }
    }
}

func typeText(_ text: String) {
    for codeUnit in text.utf16 {
        var uniChar = codeUnit
        if let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) {
            down.keyboardSetUnicodeString(stringLength: 1, unicodeString: &uniChar)
            down.post(tap: .cghidEventTap)
            usleep(3000)
        }
        if let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) {
            up.keyboardSetUnicodeString(stringLength: 1, unicodeString: &uniChar)
            up.post(tap: .cghidEventTap)
            usleep(2000)
        }
    }
}

func pressKey(_ keyName: String) {
    let lower = keyName.lowercased()

    var flags: CGEventFlags = []
    var actualKey = lower

    let modifiers: [(String, CGEventFlags)] = [
        ("cmd+", .maskCommand),
        ("shift+", .maskShift),
        ("alt+", .maskAlternate),
        ("ctrl+", .maskControl),
    ]
    for (prefix, flag) in modifiers {
        if actualKey.hasPrefix(prefix) {
            flags.insert(flag)
            actualKey = String(actualKey.dropFirst(prefix.count))
        }
    }

    let keyMap: [String: Int64] = [
        "return": 36, "enter": 76, "tab": 48, "space": 49,
        "escape": 53, "esc": 53, "backspace": 51, "delete": 51,
        "up": 126, "down": 125, "left": 123, "right": 124,
        "pageup": 116, "pagedown": 121, "home": 115, "end": 119,
        "f1": 122, "f2": 123, "f3": 99, "f4": 118, "f5": 96,
        "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109,
        "f11": 103, "f12": 111,
    ]

    if actualKey.count == 1, let char = actualKey.first {
        let scalar = char.unicodeScalars.first?.value ?? 0
        var uniChar = UniChar(scalar)
        if flags.contains(.maskCommand) {
            if let vk = keyMap[actualKey] {
                if let down = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(vk), keyDown: true) {
                    down.flags = flags
                    down.post(tap: .cghidEventTap)
                    usleep(50000)
                }
                if let up = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(vk), keyDown: false) {
                    up.flags = flags
                    up.post(tap: .cghidEventTap)
                }
                return
            }
        }
        if let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) {
            if !flags.isEmpty { down.flags = flags }
            down.keyboardSetUnicodeString(stringLength: 1, unicodeString: &uniChar)
            down.post(tap: .cghidEventTap)
            usleep(50000)
        }
        if let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) {
            if !flags.isEmpty { up.flags = flags }
            up.post(tap: .cghidEventTap)
        }
    } else {
        guard let keyCode = keyMap[actualKey] else {
            fputs("Unknown key: \(actualKey)\n", stderr)
            exit(1)
        }
        if let down = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(keyCode), keyDown: true) {
            if !flags.isEmpty { down.flags = flags }
            down.post(tap: .cghidEventTap)
            usleep(50000)
        }
        if let up = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(keyCode), keyDown: false) {
            if !flags.isEmpty { up.flags = flags }
            up.post(tap: .cghidEventTap)
        }
    }
}

func scroll(dx: Int64, dy: Int64) {
    if let event = CGEvent(source: nil) {
        event.type = .scrollWheel
        event.setIntegerValueField(.scrollWheelEventDeltaAxis1, value: dy)
        event.setIntegerValueField(.scrollWheelEventDeltaAxis2, value: dx)
        event.post(tap: .cghidEventTap)
    }
}

switch action {
case "click":
    guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else { exit(1) }
    click(at: CGPoint(x: x, y: y))

case "doubleclick":
    guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else { exit(1) }
    click(at: CGPoint(x: x, y: y), clicks: 2)

case "rightclick":
    guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else { exit(1) }
    click(at: CGPoint(x: x, y: y), button: .right)

case "type":
    guard args.count >= 3 else { exit(1) }
    typeText(args[2])

case "key":
    guard args.count >= 3 else { exit(1) }
    pressKey(args[2])

case "scroll":
    guard args.count >= 4, let dx = Int64(args[2]), let dy = Int64(args[3]) else { exit(1) }
    scroll(dx: dx, dy: dy)

default:
    fputs("Unknown action: \(action)\n", stderr)
    exit(1)
}
