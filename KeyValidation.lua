-- ╔══════════════════════════════════════════╗
-- ║    YOPI ON AIR — Key Validation          ║
-- ║  Paste this at the TOP of YopiOnAir.lua  ║
-- ╚══════════════════════════════════════════╝

-- ════════════════════════════════════════════
-- CONFIG — change API_URL to your Railway URL
-- ════════════════════════════════════════════
local API_URL   = "https://your-app.railway.app"  -- <-- your Railway URL here
local KEY_FILE  = "yopi_key.txt"   -- saved on disk so you don't re-enter every time

local HttpService = game:GetService("HttpService")
local Players     = game:GetService("Players")
local CoreGui     = game:GetService("CoreGui")
local lp          = Players.LocalPlayer

-- ── Get HWID (executor fingerprint) ──────────
local function getHWID()
    if gethwid then return gethwid() end
    if syn and syn.request then return tostring(game:GetService("RbxAnalyticsService"):GetClientId()) end
    return tostring(game:GetService("RbxAnalyticsService"):GetClientId())
end

-- ── Load saved key ────────────────────────────
local function loadKey()
    if isfile and isfile(KEY_FILE) then
        return readfile(KEY_FILE):gsub("%s","")
    end
    return nil
end

-- ── Save key ──────────────────────────────────
local function saveKey(key)
    if writefile then writefile(KEY_FILE, key) end
end

-- ── Validate key against backend ──────────────
local function validateKey(key, hwid)
    local ok, result = pcall(function()
        local reqFn = (syn and syn.request) or request or http_request
        if not reqFn then error("No HTTP function") end
        local res = reqFn({
            Url    = API_URL .. "/validate",
            Method = "POST",
            Headers = { ["Content-Type"] = "application/json" },
            Body   = HttpService:JSONEncode({ key=key, hwid=hwid }),
        })
        return HttpService:JSONDecode(res.Body)
    end)
    if not ok then return false, "Connection error" end
    return result.valid, result.reason
end

-- ════════════════════════════════════════════
-- KEY INPUT GUI
-- ════════════════════════════════════════════
local function showKeyPrompt(onSuccess)
    if CoreGui:FindFirstChild("YopiKeyPrompt") then
        CoreGui.YopiKeyPrompt:Destroy()
    end

    local sg = Instance.new("ScreenGui")
    sg.Name="YopiKeyPrompt"; sg.ResetOnSpawn=false; sg.IgnoreGuiInset=true
    pcall(function() sg.Parent=CoreGui end)
    if not sg.Parent then sg.Parent=lp.PlayerGui end

    -- Backdrop
    local bg=Instance.new("Frame",sg)
    bg.Size=UDim2.new(1,0,1,0); bg.BackgroundColor3=Color3.new(0,0,0)
    bg.BackgroundTransparency=0.4; bg.BorderSizePixel=0

    -- Card
    local card=Instance.new("Frame",sg)
    card.Size=UDim2.fromOffset(360,220)
    card.Position=UDim2.new(0.5,-180,0.5,-110)
    card.BackgroundColor3=Color3.fromRGB(14,11,6); card.BorderSizePixel=0
    local cr=Instance.new("UICorner",card); cr.CornerRadius=UDim.new(0,12)
    local cs=Instance.new("UIStroke",card); cs.Color=Color3.fromRGB(255,140,0); cs.Thickness=1.5

    -- Title
    local title=Instance.new("TextLabel",card)
    title.Size=UDim2.new(1,0,0,40); title.BackgroundTransparency=1
    title.Text="🔑  YOPI ON AIR"; title.TextColor3=Color3.fromRGB(255,140,0)
    title.Font=Enum.Font.GothamBold; title.TextSize=16

    local sub=Instance.new("TextLabel",card)
    sub.Size=UDim2.new(1,0,0,20); sub.Position=UDim2.fromOffset(0,38)
    sub.BackgroundTransparency=1; sub.Text="Enter your key to continue"
    sub.TextColor3=Color3.fromRGB(110,100,80); sub.Font=Enum.Font.Gotham; sub.TextSize=11

    -- Input box
    local inputBg=Instance.new("Frame",card)
    inputBg.Size=UDim2.new(1,-30,0,38); inputBg.Position=UDim2.fromOffset(15,70)
    inputBg.BackgroundColor3=Color3.fromRGB(22,18,10); inputBg.BorderSizePixel=0
    local ir=Instance.new("UICorner",inputBg); ir.CornerRadius=UDim.new(0,7)
    local is=Instance.new("UIStroke",inputBg); is.Color=Color3.fromRGB(55,48,30); is.Thickness=1

    local input=Instance.new("TextBox",inputBg)
    input.Size=UDim2.new(1,-16,1,0); input.Position=UDim2.fromOffset(8,0)
    input.BackgroundTransparency=1; input.PlaceholderText="YOPI-XXXXXX-XXXXXX-XXXXXX"
    input.PlaceholderColor3=Color3.fromRGB(70,65,50)
    input.TextColor3=Color3.fromRGB(220,215,200); input.Font=Enum.Font.Gotham; input.TextSize=12
    input.Text=loadKey() or ""; input.ClearTextOnFocus=false

    -- Status label
    local status=Instance.new("TextLabel",card)
    status.Size=UDim2.new(1,-30,0,18); status.Position=UDim2.fromOffset(15,114)
    status.BackgroundTransparency=1; status.Text=""
    status.TextColor3=Color3.fromRGB(200,60,60); status.Font=Enum.Font.Gotham; status.TextSize=10
    status.TextXAlignment=Enum.TextXAlignment.Left

    -- Confirm button
    local confirmBtn=Instance.new("TextButton",card)
    confirmBtn.Size=UDim2.new(1,-30,0,40); confirmBtn.Position=UDim2.fromOffset(15,140)
    confirmBtn.BackgroundColor3=Color3.fromRGB(200,120,0); confirmBtn.BorderSizePixel=0
    confirmBtn.Text="Confirm"; confirmBtn.TextColor3=Color3.new(1,1,1)
    confirmBtn.Font=Enum.Font.GothamBold; confirmBtn.TextSize=13
    local br=Instance.new("UICorner",confirmBtn); br.CornerRadius=UDim.new(0,8)

    local loading=false
    confirmBtn.MouseButton1Click:Connect(function()
        if loading then return end
        local key=input.Text:gsub("%s",""):upper()
        if key=="" then status.Text="⚠ Enter your key"; return end

        loading=true
        confirmBtn.Text="Validating..."
        confirmBtn.BackgroundColor3=Color3.fromRGB(80,65,20)
        status.Text=""

        task.spawn(function()
            local hwid=getHWID()
            local valid, reason = validateKey(key, hwid)

            if valid then
                saveKey(key)
                status.TextColor3=Color3.fromRGB(60,200,80)
                status.Text="✅ Key valid! Loading..."
                task.wait(0.8)
                sg:Destroy()
                onSuccess()
            else
                loading=false
                confirmBtn.Text="Confirm"
                confirmBtn.BackgroundColor3=Color3.fromRGB(200,120,0)
                status.TextColor3=Color3.fromRGB(200,60,60)
                status.Text="❌ " .. (reason or "Invalid key")
            end
        end)
    end)
    -- Touch support
    confirmBtn.TouchTap:Connect(function() confirmBtn.MouseButton1Click:Fire() end)
end

-- ════════════════════════════════════════════
-- RUN KEY CHECK BEFORE LOADING SCRIPT
-- ════════════════════════════════════════════
local function runWithKeyCheck(mainFunction)
    local savedKey = loadKey()

    if savedKey and savedKey ~= "" then
        -- Try saved key silently
        local hwid = getHWID()
        local valid, reason = validateKey(savedKey, hwid)
        if valid then
            print("[Yopi] Key valid ✓")
            mainFunction()
            return
        else
            print("[Yopi] Saved key invalid: " .. tostring(reason))
            if writefile then writefile(KEY_FILE, "") end
        end
    end

    -- Show prompt
    showKeyPrompt(mainFunction)
end

-- ══════════════════════════════════════════════════════════
-- HOW TO USE:
-- Wrap your entire script in a function and call it like:
--
-- runWithKeyCheck(function()
--     -- ALL your script code goes here
--     -- (the rest of YopiOnAir.lua)
-- end)
-- ══════════════════════════════════════════════════════════
