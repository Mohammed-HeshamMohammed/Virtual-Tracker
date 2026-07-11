on normalizeUrl(rawText)
    if rawText is missing value then return ""
    set trimmed to my trimText(rawText)
    if trimmed is "" then return ""
    if trimmed starts with "http://" or trimmed starts with "https://" then
        return trimmed
    end if
    if trimmed contains "." and trimmed does not contain " " then
        return "https://" & trimmed
    end if
    return ""
end normalizeUrl

on trimText(t)
    set AppleScript's text item delimiters to {" "}
    set parts to text items of t
    set AppleScript's text item delimiters to ""
    return parts as string
end trimText

on trySafariUrl()
    try
        tell application "Safari"
            if (count of windows) > 0 then
                return my normalizeUrl(URL of current tab of front window)
            end if
        end tell
    end try
    return ""
end trySafariUrl

on tryChromiumUrl(appName)
    try
        tell application appName
            if (count of windows) > 0 then
                return my normalizeUrl(URL of active tab of front window)
            end if
        end tell
    end try
    return ""
end tryChromiumUrl

on tryBrowserByBundle(bundleId)
    if bundleId is "" then return ""
    if bundleId is "com.apple.safari" then return my trySafariUrl()
    if bundleId is "com.google.chrome" then return my tryChromiumUrl("Google Chrome")
    if bundleId starts with "com.microsoft.edgemac" then return my tryChromiumUrl("Microsoft Edge")
    if bundleId is "com.brave.browser" then return my tryChromiumUrl("Brave Browser")
    if bundleId is "com.operasoftware.opera" then return my tryChromiumUrl("Opera")
    if bundleId is "com.operasoftware.operagx" then return my tryChromiumUrl("Opera GX")
    if bundleId is "com.vivaldi.vivaldi" then return my tryChromiumUrl("Vivaldi")
    if bundleId is "company.thebrowser.browser" then return my tryChromiumUrl("Arc")
    return ""
end tryBrowserByBundle

on tryBrowserByProcess(processName)
    if processName is "" then return ""
    if processName is "Safari" then return my trySafariUrl()
    if processName is "Google Chrome" then return my tryChromiumUrl("Google Chrome")
    if processName is "Microsoft Edge" then return my tryChromiumUrl("Microsoft Edge")
    if processName is "Brave Browser" then return my tryChromiumUrl("Brave Browser")
    if processName is "Opera" then return my tryChromiumUrl("Opera")
    if processName is "Opera GX" then return my tryChromiumUrl("Opera GX")
    if processName is "Vivaldi" then return my tryChromiumUrl("Vivaldi")
    if processName is "Arc" then return my tryChromiumUrl("Arc")
    return ""
end tryBrowserByProcess

on readFirefoxUrl(processName)
    set procName to processName
    if procName is "" then set procName to "Firefox"
    try
        tell application "System Events"
            tell process procName
                if (count of windows) is 0 then return ""
                set win to front window
                repeat with tb in toolbars of win
                    repeat with fld in text fields of tb
                        try
                            set val to value of fld
                            set urlText to my normalizeUrl(val)
                            if urlText is not "" then return urlText
                        end try
                    end repeat
                    repeat with cb in combo boxes of tb
                        try
                            set val to value of cb
                            set urlText to my normalizeUrl(val)
                            if urlText is not "" then return urlText
                        end try
                    end repeat
                end repeat
            end tell
        end tell
    end try
    return ""
end readFirefoxUrl

on readGenericToolbarUrl(processName)
    if processName is "" then return ""
    try
        tell application "System Events"
            tell process processName
                if (count of windows) is 0 then return ""
                set win to front window
                repeat with tb in toolbars of win
                    repeat with fld in text fields of tb
                        try
                            set desc to description of fld
                            set nm to name of fld
                            set hint to desc & " " & nm
                            if hint contains "address" or hint contains "location" or hint contains "url" or hint contains "search" then
                                set urlText to my normalizeUrl(value of fld)
                                if urlText is not "" then return urlText
                            end if
                        end try
                    end repeat
                end repeat
                repeat with fld in text fields of win
                    try
                        set urlText to my normalizeUrl(value of fld)
                        if urlText is not "" then return urlText
                    end try
                end repeat
            end tell
        end tell
    end try
    return ""
end readGenericToolbarUrl

on run argv
    set bundleId to ""
    set processName to ""
    if (count of argv) >= 1 then set bundleId to item 1 of argv
    if (count of argv) >= 2 then set processName to item 2 of argv

    set url to my tryBrowserByBundle(bundleId)
    if url is not "" then return url

    set url to my tryBrowserByProcess(processName)
    if url is not "" then return url

    if bundleId is "org.mozilla.firefox" or processName is "Firefox" then
        set url to my readFirefoxUrl(processName)
        if url is not "" then return url
    end if

    set url to my readGenericToolbarUrl(processName)
    if url is not "" then return url

    return ""
end run
