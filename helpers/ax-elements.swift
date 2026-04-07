import Foundation
import AppKit

// OraAI Accessibility Helper
// Enumerates interactive UI elements of the frontmost app with pixel-perfect positions.

struct UIElement: Codable {
    let id: Int
    let role: String
    let label: String
    let x: Int  // center X (screen coords)
    let y: Int  // center Y (screen coords)
    let w: Int
    let h: Int
}

let interactiveRoles: Set<String> = [
    "AXButton", "AXTextField", "AXTextArea", "AXCheckBox",
    "AXRadioButton", "AXPopUpButton", "AXMenuItem", "AXLink",
    "AXComboBox", "AXSlider", "AXTab", "AXTabGroup",
    "AXToolbar", "AXMenuBarItem", "AXMenuButton", "AXImage",
    "AXStaticText", "AXCell", "AXRow", "AXColumn",
    "AXIncrementor", "AXDisclosureTriangle", "AXColorWell",
    "AXSearchField", "AXValueIndicator", "AXSegmentedControl"
]

func getLabel(_ element: AXUIElement) -> String {
    // Try multiple attributes for a useful label
    for attr in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute, kAXRoleDescriptionAttribute] {
        var ref: CFTypeRef?
        AXUIElementCopyAttributeValue(element, attr as CFString, &ref)
        if let s = ref as? String, !s.isEmpty {
            return s
        }
    }
    return ""
}

// Roles to SKIP (containers that aren't useful targets)
let skipRoles: Set<String> = [
    "AXWindow", "AXApplication", "AXScrollArea", "AXGroup",
    "AXSplitGroup", "AXSplitter", "AXLayoutArea", "AXLayoutItem",
    "AXList", "AXOutline", "AXBrowser", "AXScrollBar",
]

func getElements(_ element: AXUIElement, depth: Int, results: inout [UIElement], nextId: inout Int) {
    guard depth < 30 else { return }       // Very deep for Electron/web apps
    guard results.count < 500 else { return }

    var roleRef: CFTypeRef?
    AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleRef)
    let role = (roleRef as? String) ?? ""

    // Get position and size
    var posRef: CFTypeRef?
    AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRef)
    var pos = CGPoint.zero
    if let pr = posRef { AXValueGetValue(pr as! AXValue, .cgPoint, &pos) }

    var sizeRef: CFTypeRef?
    AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef)
    var size = CGSize.zero
    if let sr = sizeRef { AXValueGetValue(sr as! AXValue, .cgSize, &size) }

    let label = getLabel(element)

    // Include ANY element that has a label and a reasonable size
    // Skip pure container roles unless they have a meaningful label
    let isContainer = skipRoles.contains(role)
    let hasLabel = !label.isEmpty
    let hasSize = size.width > 5 && size.height > 5 && size.width < 2000 && size.height < 1500

    // Skip generic containers and noise
    let genericLabels: Set<String> = ["group", "menu bar", "toolbar", "scroll area", ""]
    let isGenericLabel = genericLabels.contains(label.lowercased())
    let isLargeContainer = size.width > 600 && size.height > 400

    if hasSize && !isContainer && role != "AXWindow" && role != "AXApplication" && role != "AXMenuBar" {
        // Include if: has a meaningful label, OR is a small interactive element
        let isUseful = (hasLabel && !isGenericLabel) || (!isLargeContainer && !isGenericLabel)

        if isUseful {
            results.append(UIElement(
                id: nextId,
                role: role.replacingOccurrences(of: "AX", with: ""),
                label: String(label.prefix(100)),
                x: Int(pos.x + size.width / 2),
                y: Int(pos.y + size.height / 2),
                w: Int(size.width),
                h: Int(size.height)
            ))
            nextId += 1
        }
    }

    // Always recurse into children — web apps have deep trees
    var childrenRef: CFTypeRef?
    AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef)
    if let children = childrenRef as? [AXUIElement] {
        for child in children {
            getElements(child, depth: depth + 1, results: &results, nextId: &nextId)
        }
    }
}

// --- Main ---

// Accept PID as argument, or find frontmost non-OraAI app
let skipBundles: Set<String> = ["com.github.Electron", "com.oraai.app", "com.electron.electron"]

var targetApp: NSRunningApplication? = nil

if CommandLine.arguments.count > 1, let pid = Int32(CommandLine.arguments[1]) {
    // PID passed from Electron — use it directly
    targetApp = NSRunningApplication(processIdentifier: pid)
} else {
    // Fallback: find frontmost non-OraAI app
    if let front = NSWorkspace.shared.frontmostApplication,
       let bid = front.bundleIdentifier,
       !skipBundles.contains(bid) {
        targetApp = front
    } else {
        let apps = NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular && !$0.isHidden }
        for a in apps {
            if let bid = a.bundleIdentifier, !skipBundles.contains(bid) {
                targetApp = a
                break
            }
        }
    }
}

guard let selectedApp = targetApp else {
    print("[]")
    exit(0)
}

let app = AXUIElementCreateApplication(selectedApp.processIdentifier)
var results: [UIElement] = []
var nextId = 1

// Get windows
var windowsRef: CFTypeRef?
AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsRef)
if let windows = windowsRef as? [AXUIElement] {
    for window in windows {
        getElements(window, depth: 0, results: &results, nextId: &nextId)
    }
}

// Also enumerate menu bar
var menuRef: CFTypeRef?
AXUIElementCopyAttributeValue(app, kAXMenuBarAttribute as CFString, &menuRef)
if menuRef != nil {
    let menu = menuRef as! AXUIElement
    getElements(menu, depth: 0, results: &results, nextId: &nextId)
}

let encoder = JSONEncoder()
let data = try! encoder.encode(results)
print(String(data: data, encoding: .utf8)!)
