-- SF6 Color Sync clipboard bridge v1.1
-- Install beside EMV Engine and Freecam in reframework/autorun/.
-- Reads EMV's material cache; never writes game material values or CMD files.
local PREFIX = "SF6COLORS:1:"
local selected_key, export_text, status = nil, "", ""
local groups = {}

local function rgba(value)
    if not value then return nil end
    local ok, result = pcall(function() return { value.x, value.y, value.z, value.w } end)
    if not ok or #result ~= 4 then return nil end
    for _, channel in ipairs(result) do
        if type(channel) ~= "number" or channel ~= channel or channel == math.huge or channel == -math.huge then return nil end
    end
    return result
end

local function differs(current, original)
    local a, b = rgba(current), rgba(original)
    if a and b then
        for i = 1, 4 do if a[i] ~= b[i] then return true end end
        return false
    end
    return current ~= original
end

local function in_range(color)
    for _, channel in ipairs(color) do if channel < 0 or channel > 1 then return false end end
    return true
end

local function ascii_json(text)
    -- REFramework's clipboard API uses Windows CF_TEXT. Escaping non-ASCII
    -- JSON characters preserves exact material names across Windows locales.
    local parts = {}
    for _, codepoint in utf8.codes(text) do
        if codepoint < 128 then
            parts[#parts + 1] = string.char(codepoint)
        elseif codepoint <= 0xFFFF then
            parts[#parts + 1] = string.format("\\u%04X", codepoint)
        else
            local value = codepoint - 0x10000
            parts[#parts + 1] = string.format("\\u%04X\\u%04X", 0xD800 + math.floor(value / 0x400), 0xDC00 + value % 0x400)
        end
    end
    return table.concat(parts)
end

local function controller_for(xform)
    -- Use EMV wrappers when already present. Creating a new EMV GameObject
    -- would initialize materials and could replace the original-color cache.
    local cached = held_transforms and held_transforms[xform]
    local controller = cached and cached.components_named and cached.components_named.PlayerColorController
    if controller then return controller end
    local object = xform:call("get_GameObject")
    local components = object and object:call("get_Components")
    components = components and components:get_elements() or {}
    for _, component in ipairs(components) do
        local type_name = component:get_type_definition():get_full_name()
        if type_name:match("PlayerColorController$") then return component end
    end
end

local function context_for(object)
    local source = { object = object.name_w_parent or object.name or "Selected mesh" }
    local xform = object.xform
    for _ = 1, 16 do
        if not xform then break end
        local ok, controller = pcall(controller_for, xform)
        if ok and controller then
            -- The controller identifies the owning player for mesh grouping.
            -- Destination CMD selection belongs to the user in Color Sync.
            return tostring(xform:get_address()), source
        end
        local parent_ok, parent = pcall(function() return xform:call("get_Parent") end)
        if not parent_ok then break end
        xform = parent
    end
    -- Missing controller: keep meshes separate rather than mix two players.
    return "mesh:" .. tostring(object.xform:get_address()), source
end

local function has_colors(object)
    for _, material in ipairs(object.materials or {}) do
        for _, name in ipairs(material.variable_names or {}) do
            if name:match("^CustomizeColor_%d+$") then return true end
        end
    end
    return false
end

local function refresh_groups()
    export_text, status = "", ""
    local found = {}
    for _, object in pairs(held_transforms or {}) do
        local ok, key, source = pcall(function()
            if not object.xform or not has_colors(object) then return end
            local owner_key, owner_source = context_for(object)
            return owner_key, owner_source
        end)
        if ok and key then
            local group = found[key] or { key = key, source = source, objects = {} }
            found[key] = group
            group.objects[#group.objects + 1] = object
        end
    end
    groups = {}
    for _, group in pairs(found) do
        group.label = group.source.object
        groups[#groups + 1] = group
    end
    table.sort(groups, function(a, b) return a.label < b.label end)
    local selected_exists = false
    for _, group in ipairs(groups) do if group.key == selected_key then selected_exists = true end end
    if not selected_exists then selected_key = groups[1] and groups[1].key or nil end
end

local function build_export(group)
    local changes, skipped, stale = {}, 0, 0
    local source
    for _, object in ipairs(group.objects) do
        local ok, key, current_source = pcall(context_for, object)
        if not ok or key ~= group.key then
            stale = stale + 1
        else
            source = source or current_source
            for _, material in ipairs(object.materials or {}) do
                for index, parameter in ipairs(material.variable_names or {}) do
                    local current = material.variables and material.variables[index]
                    local original = material.orig_vars and material.orig_vars[index]
                    if current ~= nil and original ~= nil and differs(current, original) then
                        local color = rgba(current)
                        if parameter:match("^CustomizeColor_%d+$") and color and in_range(color) then
                            changes[#changes + 1] = {
                                material = material.name, parameter = parameter, rgba = color,
                                mesh = object.name_w_parent or object.name or "",
                            }
                        else
                            skipped = skipped + 1
                        end
                    end
                end
            end
        end
    end
    if stale > 0 then error("Character objects changed. Refresh characters and export again.") end
    if #changes == 0 then error("No edited CustomizeColor slots found. Open the character's Materials editor in EMV and make your color changes first.") end
    if #changes > 4096 then error("Too many edits for one export (maximum 4096).") end
    table.sort(changes, function(a, b)
        local a_key, b_key = a.material .. "|" .. a.parameter .. "|" .. a.mesh, b.material .. "|" .. b.parameter .. "|" .. b.mesh
        return a_key < b_key
    end)
    local encoded = json.dump_string({
        format = "sf6-freecam-colors", version = 1, colorSpace = "linear",
        source = source or group.source, changes = changes, skippedFields = skipped,
    })
    if type(encoded) ~= "string" or encoded == "" then error("REFramework could not encode the color export.") end
    local text = PREFIX .. ascii_json(encoded)
    if #text > 1024 * 1024 then error("Color export exceeds the 1 MiB limit.") end
    return text, #changes, skipped
end

re.on_draw_ui(function()
    if reframework.get_game_name() ~= "sf6" then return end
    if not imgui.tree_node("SF6 Color Sync") then return end
    if not EMV or not EMV.Material then
        imgui.text("Install EMV Engine and open Freecam or EMV's material editor first.")
        imgui.tree_pop()
        return
    end
    imgui.text("Edit colors in EMV / Freecam, then copy them into Color Sync.")
    if imgui.button("Refresh characters") or #groups == 0 then refresh_groups() end
    if #groups == 0 then
        imgui.text("No material caches found. Open the character's Materials editor in EMV first.")
    else
        local labels, selected_index = {}, 1
        for index, group in ipairs(groups) do
            labels[index] = group.label
            if group.key == selected_key then selected_index = index end
        end
        local changed, new_index = imgui.combo("Character / mesh", selected_index, labels)
        if changed then selected_key, export_text, status = groups[new_index].key, "", "" end
        local group = groups[changed and new_index or selected_index]
        imgui.text("Exports edited CustomizeColor_N RGBA only; includes EMV Change Multiple edits in cached meshes.")
        if imgui.button("Copy for Color Sync") then
            local ok, text, count, skipped = pcall(build_export, group)
            if ok then
                export_text = text
                local copy_ok, copy_result = pcall(sdk.copy_to_clipboard, text)
                status = (copy_ok and copy_result == true) and ("Copied " .. count .. " color edits. Paste in Color Sync's Import Freecam Colors panel.")
                    or ("Clipboard copy failed. Copy the text below with Ctrl+A, Ctrl+C.")
                if skipped > 0 then status = status .. " Skipped " .. skipped .. " unsupported or out-of-range fields." end
            else
                export_text, status = "", tostring(text)
            end
        end
        if export_text ~= "" then
            imgui.input_text_multiline("Export string", export_text, Vector2f.new(600, 130), 16384) -- ReadOnly
            if imgui.button("Save color export JSON") then
                local document = json.load_string(export_text:sub(#PREFIX + 1))
                local saved = document and json.dump_file("SF6ColorSync/colors.sf6freecam.json", document)
                status = saved and "Saved reframework/data/SF6ColorSync/colors.sf6freecam.json. Import this file in Color Sync."
                    or "Could not save the JSON file. Use the export string above."
            end
        end
    end
    if status ~= "" then imgui.text(status) end
    imgui.tree_pop()
end)
