-- SF6 Color Sync clipboard bridge v1.6
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
local function color_parameter(name)
    return type(name) == "string" and name:match("^CustomizeColor_%d+$") and name or nil
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

local function character_id(text)
    -- Runtime object names often expose only esf032v00, without a resource path.
    -- Require exactly three ID digits; esf0320 is not Ingrid's esf032.
    return type(text) == "string" and text:lower():match("%f[%w](esf%d%d%d)%f[%D]") or nil
end

local function resource_for(object)
    local paths = object.mpaths or {}
    local resources = { paths.mesh_path or "", object.mesh_name or "", paths.mdf2_path or "" }
    for _, path in ipairs(resources) do
        if type(path) == "string" then
            local normalized = path:lower():gsub("\\", "/")
            local id, costume = normalized:match("product/model/esf/(esf%d%d%d)/(%d%d%d)/")
            if id then return id, costume, path end
        end
    end
    -- A filename can identify the costume when EMV omits its directories.
    for _, path in ipairs(resources) do
        if type(path) == "string" then
            local id, costume = path:lower():match("%f[%w](esf%d%d%d)_(%d%d%d)_")
            if id then return id, costume, path end
        end
    end
    for _, path in ipairs(resources) do
        local id = character_id(path)
        if id then return id end
    end
end

local function transform_name(xform)
    local cached = held_transforms and held_transforms[xform]
    if cached and cached.name then return cached.name end
    local ok, name = pcall(function() return xform:call("get_GameObject"):call("get_Name") end)
    return ok and type(name) == "string" and name or nil
end

local function context_for(object)
    local id, costume, resource_path = resource_for(object)
    id = id or character_id(object.name) or character_id(object.name_w_parent)
    local xform = object.xform
    local controller_root, controller_branch, actor_root, player_label, child
    for _ = 1, 32 do
        if not xform then break end
        local address = tostring(xform:get_address())
        local name = transform_name(xform)
        id = id or character_id(name)
        if player_roots[address] or name == "P1" or name == "P2" then
            actor_root, player_label = xform, player_roots[address] or name
            break
        end
        local ok, controller = pcall(controller_for, xform)
        if ok and controller and not controller_root then
            controller_root = xform
            -- Without Freecam player roots, a shared controller can contain
            -- sibling actor branches. Keep those branches separate; a body
            -- cached for one branch must not claim another actor's donor part.
            if child and child ~= object.xform then
                local cached_child = held_transforms and held_transforms[child]
                if not cached_child or not cached_child.materials or #cached_child.materials == 0 then
                    controller_branch = child
                end
            end
        end
        local parent_ok, parent = pcall(function() return xform:call("get_Parent") end)
        if not parent_ok then break end
        child, xform = xform, parent
    end
    -- Actor roots take precedence over a controller shared by multiple actors.
    local owner = actor_root or controller_branch or controller_root
    local address = tostring((owner or object.xform):get_address())
    local owner_name = owner and transform_name(owner) or object.name_w_parent or object.name or "Selected mesh"
    local character_label = character_names[id] or (id and ("Unknown character (" .. id .. ")")) or "Unknown character"
    local costume_label = character_label .. (costume and (" C" .. tonumber(costume)) or " (costume unknown)")
    local label = (player_label and (player_label .. " - ") or "") .. costume_label
    if not player_label then
        -- Keep useful custom object names, but avoid repeating raw esf names
        -- after the friendly character label. The address distinguishes actors.
        local owner_label = character_id(owner_name) and (owner and "Character" or "Mesh") or owner_name
        label = label .. " - " .. (owner_label or "Character") .. " #" .. address
    end
    local source = { object = label }
    local main_material = false
    for _, material in ipairs(object.materials or {}) do
        if type(material.name) == "string" and material.name:match("^esf_Body%d+$") then main_material = true end
    end
    local owner_key = actor_root and ("actor:" .. address)
        or controller_root and ("controller:" .. tostring(controller_root:get_address())
            .. (controller_branch and ("|branch:" .. address) or ""))
        or ("mesh:" .. address)
    local resource_key = (id or "unknown") .. "|" .. (costume or "unknown")
    local info = { title = label, resource = resource_path, owner_key = owner_key,
        owner_kind = actor_root and "actor" or owner and "controller" or "mesh",
        resource_key = resource_key, character_id = id, costume = costume, main_material = main_material,
        priority = id and ((main_material and 4 or 0) + (costume and 2 or 1)) or 0 }
    local key = actor_root and owner_key or (owner_key .. "|" .. resource_key)
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

local function edited_signature(object)
    local parts = {}
    for _, material in ipairs(object.materials or {}) do
        for index, parameter in ipairs(material.variable_names or {}) do
            local current = material.variables and material.variables[index]
            local original = material.orig_vars and material.orig_vars[index]
            if color_parameter(parameter) and current ~= nil and original ~= nil and differs(current, original) then
                local color = rgba(current)
                if color and in_range(color) then
                    parts[#parts + 1] = table.concat({material.name or "", parameter,
                        string.format("%.17g,%.17g,%.17g,%.17g", table.unpack(color))}, "|")
                end
            end
        end
    end
    table.sort(parts)
    return #parts > 0 and (tostring(object) .. "|" .. table.concat(parts, ";")) or nil
end

local function collect_groups()
    refresh_player_roots()
    local entries, body_anchors = {}, {}
    -- A costume can reuse parts from another resource folder. Locate its body
    -- before grouping those parts; unedited bodies still identify the costume.
    for _, object in pairs(held_transforms or {}) do
        local ok, key, source, info = pcall(function()
            if not object.xform or not object.materials then return end
            return context_for(object)
        end)
        if ok and key then
            entries[#entries + 1] = {object = object, key = key, source = source, info = info}
            if info.owner_kind == "controller" and info.main_material and info.character_id and info.costume then
                local anchors = body_anchors[info.owner_key] or {}
                anchors[info.resource_key] = {source = source, info = info}
                body_anchors[info.owner_key] = anchors
            end
        end
    end
    local found, object_keys = {}, {}
    for _, entry in ipairs(entries) do
        local object, key, source, info = entry.object, entry.key, entry.source, entry.info
        if has_colors(object) then
            local anchors = body_anchors[info.owner_key]
            if anchors then
                local single_anchor, count = nil, 0
                for _, anchor in pairs(anchors) do single_anchor, count = anchor, count + 1 end
                -- Multiple actual bodies under a shared controller remain
                -- partitioned. A single body owns all its reused donor parts.
                if count == 1 then
                    key = info.owner_key .. "|" .. single_anchor.info.resource_key
                    source, info = single_anchor.source, single_anchor.info
                end
            end
            local group = found[key] or {key = key, source = source, info = info, objects = {}, edit_signatures = {}}
            if info.priority > group.info.priority then group.source, group.info = source, info end
            group.objects[#group.objects + 1] = object
            local signature = edited_signature(object)
            if signature then group.edit_signatures[#group.edit_signatures + 1] = signature end
            found[key], object_keys[object] = group, key
        end
    end
    for _, group in pairs(found) do
        table.sort(group.edit_signatures)
        group.edited = #group.edit_signatures > 0
        group.edit_signature = table.concat(group.edit_signatures, "\n")
    end
    return found, object_keys
end

local function refresh_groups(reset_output)
    local previous_key, previous_groups = selected_key, {}
    for _, group in ipairs(groups) do previous_groups[group.key] = group end
    local found = collect_groups()
    groups = {}
    for _, group in pairs(found) do
        if group.edited then
            local previous = previous_groups[group.key]
            -- Automatic updates retain old wrappers until Copy checks them.
            -- Explicit Refresh accepts the current cache as a new snapshot.
            group.snapshot_objects = not reset_output and previous and previous.snapshot_objects or group.objects
            group.label = group.info.title .. " (" .. #group.objects .. " cached meshes)"
            groups[#groups + 1] = group
        end
    end
    table.sort(groups, function(a, b) return a.label < b.label end)
    local selected_exists = false
    for _, group in ipairs(groups) do if group.key == selected_key then selected_exists = true end end
    if not selected_exists then selected_key = groups[1] and groups[1].key or nil end
    local previous = previous_groups[previous_key]
    local current = selected_key and found[selected_key]
    if reset_output or previous_key ~= selected_key or not previous or not current
        or previous.edit_signature ~= current.edit_signature then
        export_text, status = "", ""
    end
end

local function build_export(group)
    local current_groups, object_keys = collect_groups()
    local changes, skipped, stale = {}, 0, 0
    for _, object in ipairs(group.snapshot_objects or group.objects) do
        if object_keys[object] ~= group.key or held_transforms[object.xform] ~= object then
            stale = stale + 1
        end
    end
    if stale > 0 then error("Character objects changed. Refresh characters and export again.") end
    -- Copy scans EMV's current cache again to include newly opened parts
    -- belonging to the selected player. Never create wrappers
    -- or refresh materials here: that could replace EMV's original colors.
    local current_group = current_groups[group.key]
    local export_objects = current_group and current_group.objects or {}
    for _, object in ipairs(export_objects) do
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
    group.objects = export_objects
    group.snapshot_objects = export_objects
    if current_group then group.source, group.info = current_group.source, current_group.info end
    group.label = group.info.title .. " (" .. #export_objects .. " cached meshes)"
    if #changes == 0 then error("No edited CustomizeColor_N colors found. Other shader parameters are unsupported; BaseColor requires an MDF edit.") end
    if #changes > 4096 then error("Too many edits for one export (maximum 4096).") end
    table.sort(changes, function(a, b)
        local a_key, b_key = a.material .. "|" .. a.parameter .. "|" .. a.mesh, b.material .. "|" .. b.parameter .. "|" .. b.mesh
        return a_key < b_key
    end)
    local encoded = json.dump_string({
        format = "sf6-freecam-colors", version = 1, colorSpace = "linear",
        source = group.source, changes = changes, skippedFields = skipped,
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
    imgui.text("Exporter v1.6")
    imgui.text("Edit colors in EMV / Freecam, then copy them into Color Sync.")
    refresh_groups(imgui.button("Refresh characters"))
    if #groups == 0 then
        imgui.text("No edited CustomizeColor_N colors found. Open the costume's Materials editor in EMV and edit its colors.")
    else
        local labels, selected_index = {}, 1
        for index, group in ipairs(groups) do
            labels[index] = group.label
            if group.key == selected_key then selected_index = index end
        end
        local group = groups[selected_index]
        if #groups == 1 then
            imgui.text("Edited costume: " .. group.label)
        else
            local changed, new_index = imgui.combo("Edited costume", selected_index, labels)
            if changed then
                selected_key, export_text, status = groups[new_index].key, "", ""
                group = groups[new_index]
            end
        end
        if group.info.resource then imgui.text("Costume resource: " .. group.info.resource) end
        imgui.text("Only costumes with edited CustomizeColor_N colors are listed. This list updates automatically as you change colors.")
        imgui.text("Use Refresh characters if the character objects change.")
        imgui.text("Exports edited CustomizeColor_N colors, including EMV Change Multiple edits.")
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
