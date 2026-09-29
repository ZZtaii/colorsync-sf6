-- SF6 Color Sync clipboard bridge v1.3
-- Install beside EMV Engine and Freecam in reframework/autorun/.
-- Reads EMV's material cache; never writes game material values or CMD files.
local PREFIX = "SF6COLORS:1:"
local selected_key, export_text, status = nil, "", ""
local groups = {}
local player_roots = {}
local character_names = {
    esf001="Ryu", esf002="Luke", esf003="Kimberly", esf004="Chun-Li", esf005="Manon",
    esf006="Zangief", esf007="JP", esf008="Dhalsim", esf009="Cammy", esf010="Ken",
    esf011="Dee Jay", esf012="Lily", esf013="A.K.I", esf014="Rashid", esf015="Blanka",
    esf016="Juri", esf017="Marisa", esf018="Guile", esf019="Ed", esf020="E. Honda",
    esf021="Jamie", esf022="Akuma", esf025="Sagat", esf026="M. Bison", esf027="Terry",
    esf028="Mai", esf029="Elena", esf030="C.Viper", esf031="Alex", esf032="Ingrid", esf033="Yasmine",
}
local hair_parameters = {
    OcclusionColor = "OcclusionColor", OcclutionColor = "OcclusionColor",
    PrimalySpecularColor = "PrimalySpecularColor", PrimarySpecularColor = "PrimalySpecularColor",
    SecondarySpecularColor = "SecondarySpecularColor",
    RimLight_Color = "RimLight_Color", Rimlight_Color = "RimLight_Color",
}

local function color_parameter(name)
    return name:match("^CustomizeColor_%d+$") and name or hair_parameters[name]
end

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

local function refresh_player_roots()
    player_roots = {}
    -- Lua Freecam already enumerates PlayerBehavior components in this order.
    -- Read its actors without initializing EMV wrappers or material caches.
    for index, player_behavior in ipairs(type(players) == "table" and players or {}) do
        local ok, address = pcall(function()
            return tostring(player_behavior:call("get_GameObject"):call("get_Transform"):get_address())
        end)
        if ok then player_roots[address] = "P" .. index end
    end
end

local function costume_for(object)
    local paths = object.mpaths or {}
    for _, path in ipairs({ paths.mesh_path or "", object.mesh_name or "", paths.mdf2_path or "" }) do
        if type(path) == "string" then
            local normalized = path:lower():gsub("\\", "/")
            local id, costume = normalized:match("product/model/esf/(esf%d%d%d)/(%d%d%d)/")
            if id then return id, costume, path end
        end
    end
end

local function transform_name(xform)
    local cached = held_transforms and held_transforms[xform]
    if cached and cached.name then return cached.name end
    local ok, name = pcall(function() return xform:call("get_GameObject"):call("get_Name") end)
    return ok and type(name) == "string" and name or nil
end

local function context_for(object)
    local id, costume, resource_path = costume_for(object)
    local xform = object.xform
    local controller_root, actor_root, player_label
    for _ = 1, 32 do
        if not xform then break end
        local address = tostring(xform:get_address())
        local name = transform_name(xform)
        if player_roots[address] or name == "P1" or name == "P2" then
            actor_root, player_label = xform, player_roots[address] or name
            break
        end
        local ok, controller = pcall(controller_for, xform)
        if ok and controller and not controller_root then controller_root = xform end
        local parent_ok, parent = pcall(function() return xform:call("get_Parent") end)
        if not parent_ok then break end
        xform = parent
    end
    -- Actor roots take precedence over a controller shared by multiple actors.
    -- Partition by loaded costume resources too; neither key restricts import.
    local owner = actor_root or controller_root
    local address = tostring((owner or object.xform):get_address())
    local owner_name = owner and transform_name(owner) or object.name_w_parent or object.name or "Selected mesh"
    local costume_label = id and ((character_names[id] or id) .. " C" .. tonumber(costume)) or "Costume unknown"
    local label = (player_label and (player_label .. " - ") or "") .. costume_label
    if not player_label then label = label .. " - " .. (owner_name or "Character") .. " #" .. address end
    local source = { object = label }
    local main_material = false
    for _, material in ipairs(object.materials or {}) do
        if material.name == "esf_Body00" then main_material = true end
    end
    local info = { title = label, resource = resource_path, priority = id and (main_material and 2 or 1) or 0 }
    -- Known actors own their hair/head even when those parts reuse resources
    -- from another costume. Resource partitioning is only a controller fallback.
    local key = actor_root and ("actor:" .. address)
        or ((owner and "controller:" or "mesh:") .. address .. "|" .. (id or "unknown") .. "|" .. (costume or "unknown"))
    -- Missing controller: keep meshes separate rather than mix two players.
    return key, source, info
end

local function has_colors(object)
    for _, material in ipairs(object.materials or {}) do
        for _, name in ipairs(material.variable_names or {}) do
            if color_parameter(name) then return true end
        end
    end
    return false
end

local function refresh_groups()
    export_text, status = "", ""
    refresh_player_roots()
    local found = {}
    for _, object in pairs(held_transforms or {}) do
        local ok, key, source, info = pcall(function()
            if not object.xform or not has_colors(object) then return end
            return context_for(object)
        end)
        if ok and key then
            local group = found[key] or { key = key, source = source, info = info, objects = {} }
            if info.priority > group.info.priority then group.source, group.info = source, info end
            found[key] = group
            group.objects[#group.objects + 1] = object
        end
    end
    groups = {}
    for _, group in pairs(found) do
        group.label = group.info.title .. " (" .. #group.objects .. " cached meshes)"
        groups[#groups + 1] = group
    end
    table.sort(groups, function(a, b) return a.label < b.label end)
    local selected_exists = false
    for _, group in ipairs(groups) do if group.key == selected_key then selected_exists = true end end
    if not selected_exists then selected_key = groups[1] and groups[1].key or nil end
end

local function build_export(group)
    refresh_player_roots()
    local changes, skipped, stale = {}, 0, 0
    local source, info
    for _, object in ipairs(group.objects) do
        local ok, key = pcall(context_for, object)
        if not ok or key ~= group.key or held_transforms[object.xform] ~= object then
            stale = stale + 1
        end
    end
    if stale > 0 then error("Character objects changed. Refresh characters and export again.") end
    -- EMV adds meshes to its cache as their Materials panels are opened. The
    -- character picker is a snapshot, but Copy must include newly cached hair
    -- and head meshes belonging to the selected player. Never create wrappers
    -- or refresh materials here: that could replace EMV's original colors.
    local export_objects = {}
    for _, object in pairs(held_transforms or {}) do
        local ok, key, current_source, current_info = pcall(function()
            if not object.xform or not has_colors(object) then return end
            return context_for(object)
        end)
        if ok and key == group.key then
            export_objects[#export_objects + 1] = object
            if not info or current_info.priority > info.priority then source, info = current_source, current_info end
            for _, material in ipairs(object.materials or {}) do
                for index, parameter in ipairs(material.variable_names or {}) do
                    local current = material.variables and material.variables[index]
                    local original = material.orig_vars and material.orig_vars[index]
                    if current ~= nil and original ~= nil and differs(current, original) then
                        local color = rgba(current)
                        local supported_parameter = color_parameter(parameter)
                        if supported_parameter and color and in_range(color) then
                            changes[#changes + 1] = {
                                material = material.name, parameter = supported_parameter, rgba = color,
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
    group.objects = export_objects
    if info then group.source, group.info = source, info end
    group.label = group.info.title .. " (" .. #export_objects .. " cached meshes)"
    if #changes == 0 then error("No edited supported CMD colors found. Use CustomizeColor_N or CMD hair colors; BaseColor requires an MDF edit.") end
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
    return text, #changes, skipped, #export_objects
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
        if group.info.resource then imgui.text("Costume resource: " .. group.info.resource) end
        imgui.text("Only this entry's cached meshes are exported. Open both players' Materials, then Refresh characters to list both.")
        imgui.text("Exports edited CustomizeColor_N and CMD hair colors, including EMV Change Multiple edits.")
        if group.key:match("^mesh:") then
            imgui.text("Character grouping unavailable. Open hair/head Materials, refresh characters, and export each mesh separately.")
        end
        if imgui.button("Copy for Color Sync") then
            local ok, text, count, skipped, mesh_count = pcall(build_export, group)
            if ok then
                export_text = text
                local copy_ok, copy_result = pcall(sdk.copy_to_clipboard, text)
                status = (copy_ok and copy_result == true) and ("Copied " .. count .. " color edits from " .. mesh_count .. " mesh(es). Paste in Color Sync's Import Freecam Colors panel.")
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
