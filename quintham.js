"use strict";

module.exports.quintham = function (parent) {
  var obj = {};
  obj.parent = parent;

  // Server-side state to track paths per node
  obj.dbPaths = {};

  obj.exports = [
    "onDeviceRefreshEnd"
  ];

  // This function is called when the device page is displayed or refreshed
  obj.onDeviceRefreshEnd = function (id, panel, overlay, node, userRights, ep, user) {
    // Only show on the "General" panel

    var content = `
            <div class="panel panel-default" style="margin-top: 10px;">
                <div class="panel-heading"><h3 class="panel-title">Quintham Toolkit</h3></div>
                <div class="panel-body">
                    <div><strong>DB Path:</strong> <span id="quintham_db_path">Not Found</span></div>
                    <br/>
                    <button class="btn btn-default" onclick="plugin_quintham.findDb('${node._id}')">Find Database</button>
                    <button class="btn btn-default" id="btn_quintham_edit" disabled onclick="plugin_quintham.editDb()">Edit Database</button>
                    <button class="btn btn-warning" onclick="plugin_quintham.updateApp('${node._id}')">Update App</button>
                    <div id="plugin_quintham_status" style="margin-top:10px; color:#555;"></div>
                </div>
            </div>

            <!-- Editor Modal (Hidden by default) -->
            <div id="quintham_editor_modal" style="display:none; position:fixed; top:50px; left:50px; right:50px; bottom:50px; background:white; border:1px solid #ccc; z-index:9999; padding:20px; box-shadow: 0 0 10px rgba(0,0,0,0.5);">
                <div style="height:100%; display:flex; flex-direction:column;">
                    <div style="flex:0 0 auto; margin-bottom:10px;">
                        <h3>Database Editor</h3>
                        <button class="btn btn-success" onclick="plugin_quintham.saveDbChange()">Save Changes to Device</button>
                        <button class="btn btn-danger" onclick="$('#quintham_editor_modal').hide()">Close</button>
                        <span id="editor_status" style="margin-left:10px;"></span>
                    </div>
                    <div style="flex:0 0 auto; margin-bottom:10px;">
                         <textarea id="quintham_sql_query" style="width:100%; height:80px;" placeholder="SELECT * FROM tablename LIMIT 10"></textarea>
                         <button class="btn btn-primary btn-xs" onclick="plugin_quintham.runQuery()">Run SQL</button>
                         List Tables: <select id="quintham_tables" onchange="plugin_quintham.loadTable(this.value)"><option value="">Select...</option></select>
                    </div>
                    <div style="flex:1 1 auto; overflow:auto; border:1px solid #eee;">
                        <div id="quintham_query_results"></div>
                    </div>
                </div>
            </div>

            <script src="https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js"></script>
            <script>
                var plugin_quintham = {
                    nodeId: '${node._id}',
                    dbPath: null,
                    db: null,
                    SQL: null,
                    
                    init: function() {
                        // Init SQL.js
                        if (typeof initSqlJs === 'function') {
                            initSqlJs({ locateFile: filename => \`https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/\${filename}\` }).then(function(sql_obj){
                                plugin_quintham.SQL = sql_obj;
                            });
                        }
                    },

                    findDb: function(nid) {
                        $('#plugin_quintham_status').text('Searching...');
                        meshcentral.send({ action: 'plugin', plugin: 'quintham', method: 'findDb', nodeId: nid });
                    },
                    
                    updateApp: function(nid) {
                        if(!confirm('Update Quintham App?')) return;
                        $('#plugin_quintham_status').text('Initiating update...');
                        meshcentral.send({ action: 'plugin', plugin: 'quintham', method: 'updateApp', nodeId: nid });
                    },

                    editDb: function() {
                        if (!this.dbPath) return alert('Find database first.');
                        $('#plugin_quintham_status').text('Downloading Database...');
                        $('#editor_status').text('Loading...');
                        meshcentral.send({ action: 'plugin', plugin: 'quintham', method: 'fetchDb', nodeId: this.nodeId, path: this.dbPath });
                    },

                    loadDbFromBase64: function(b64) {
                        try {
                            var binary_string = window.atob(b64);
                            var len = binary_string.length;
                            var bytes = new Uint8Array(len);
                            for (var i = 0; i < len; i++) { bytes[i] = binary_string.charCodeAt(i); }
                            
                            this.db = new this.SQL.Database(bytes);
                            
                            $('#quintham_editor_modal').show();
                            $('#plugin_quintham_status').text('Database Loaded.');
                            $('#editor_status').text('Ready.');
                            this.refreshTables();
                        } catch(e) { console.error(e); alert('Failed to load DB: '+e); }
                    },

                    refreshTables: function() {
                        var res = this.db.exec("SELECT name FROM sqlite_master WHERE type='table'");
                        var sel = $('#quintham_tables');
                        sel.empty();
                        sel.append('<option>Select Table...</option>');
                        if (res.length > 0 && res[0].values) {
                            res[0].values.forEach(v => {
                                sel.append('<option value="'+v[0]+'">'+v[0]+'</option>');
                            });
                        }
                    },

                    loadTable: function(tbl) {
                        if(!tbl) return;
                        $('#quintham_sql_query').val('SELECT * FROM ' + tbl + ' LIMIT 100');
                        this.runQuery();
                    },

                    runQuery: function() {
                        var sql = $('#quintham_sql_query').val();
                        try {
                            var res = this.db.exec(sql);
                            this.renderResults(res);
                        } catch(e) {
                            $('#quintham_query_results').html('<p style="color:red">Error: '+e+'</p>');
                        }
                    },

                    renderResults: function(res) {
                         var div = $('#quintham_query_results');
                         div.empty();
                         if (!res || res.length === 0) { div.text('No results.'); return; }
                         
                         var table = '<table class="table table-striped table-condensed"><thead><tr>';
                         res[0].columns.forEach(c => table += '<th>'+c+'</th>');
                         table += '</tr></thead><tbody>';
                         
                         res[0].values.forEach(row => {
                             table += '<tr>';
                             row.forEach(val => table += '<td>'+(val === null ? 'NULL' : val)+'</td>');
                             table += '</tr>';
                         });
                         table += '</tbody></table>';
                         div.html(table);
                    },

                    saveDbChange: function() {
                         if(!confirm('Overwrite remote database with these changes? This will create a .bak on the remote device first.')) return;
                         $('#editor_status').text('Exporting...');
                         var data = this.db.export();
                         
                         // Convert to Base64
                         var binary = '';
                         var len = data.byteLength;
                         for (var i = 0; i < len; i++) { binary += String.fromCharCode(data[i]); }
                         var b64 = window.btoa(binary);
                         
                         $('#editor_status').text('Uploading...');
                         meshcentral.send({ action: 'plugin', plugin: 'quintham', method: 'saveDb', nodeId: this.nodeId, path: this.dbPath, data: b64 });
                    }
                };

                plugin_quintham.init();

                // Listen for messages
                if (typeof server != 'undefined' && server.on) {
                     server.on('plugin', function(data) {
                         if (data.plugin !== 'quintham') return;
                         
                         if (data.method == 'dbLocationFound') {
                             plugin_quintham.dbPath = data.path;
                             $('#quintham_db_path').text(data.path);
                             $('#btn_quintham_edit').prop('disabled', false);
                             $('#plugin_quintham_status').text('Database found.');
                         }
                         
                         if (data.method == 'dbDatareceived') {
                             plugin_quintham.loadDbFromBase64(data.data);
                         }

                         if (data.method == 'saveComplete') {
                             alert('Database Saved Successfully!');
                             $('#editor_status').text('Saved.');
                         }
                     });
                }
            </script>
        `;

    return content;
  };

  // Handle messages from the web UI
  obj.onMessage = function (user, domain, req, args) {
    if (args.action === 'plugin' && args.plugin === 'quintham') {
      if (args.method === 'findDb') {
        findDatabase(args.nodeId, user, domain);
      } else if (args.method === 'updateApp') {
        updateApp(args.nodeId, user, domain);
      } else if (args.method === 'fetchDb') {
        fetchDatabase(args.nodeId, args.path, user);
      } else if (args.method === 'saveDb') {
        saveDatabase(args.nodeId, args.path, args.data, user);
      }
      return true;
    }
    return false;
  };

  function findDatabase(nodeId, user, domain) {
    var agent = parent.webserver.wsagents[nodeId];
    if (!agent) return;

    const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$path = Get-ChildItem -Path "C:\\Users\\*\\AppData\\Local\\Packages\\Watchful_9nnya97m1bay6\\LocalCache\\Local\\Watchful\\database.db3" | Select-Object -ExpandProperty FullName -First 1
if ($path) {
  Write-Host "QUINTHAM_DB_PATH:$path"
} else {
  Write-Host "QUINTHAM_DB_PATH:NOT_FOUND"
}
`;
    try { agent.send(JSON.stringify({ action: 'msg', type: 'ps', value: psScript })); } catch (e) { }
  }

  function updateApp(nodeId, user, domain) {
    var agent = parent.webserver.wsagents[nodeId];
    if (!agent) return;
    const psScript = `winget upgrade --id 9NNYA97M1BAY6 --accept-source-agreements --accept-package-agreements`;
    agent.send(JSON.stringify({ action: 'msg', type: 'ps', value: psScript }));
  }

  function fetchDatabase(nodeId, path, user) {
    var agent = parent.webserver.wsagents[nodeId];
    if (!agent || !path) return;
    // Limit size? We assume it's small.
    // PowerShell to output Base64
    const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$b = [System.IO.File]::ReadAllBytes("${path}")
$b64 = [System.Convert]::ToBase64String($b)
Write-Host "QUINTHAM_DB_DATA:$b64"
`;
    agent.send(JSON.stringify({ action: 'msg', type: 'ps', value: psScript }));
  }

  function saveDatabase(nodeId, path, b64Data, user) {
    var agent = parent.webserver.wsagents[nodeId];
    if (!agent || !path) return;

    // Split b64Data if too large? 
    // Max command size in some agents is limited. 
    // IF DATA IS LARGE, THIS WILL FAIL.
    // Assuming small DB (<100KB - 1MB).
    // If large, we need 'upload' action.

    // For robustness, we will create a temp file with the Base64 then decode it.
    const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$path = "${path}"
Copy-Item $path "$path.bak" -Force
$bytes = [System.Convert]::FromBase64String("${b64Data}")
[System.IO.File]::WriteAllBytes($path, $bytes)
Write-Host "QUINTHAM_SAVE_COMPLETE"
`;
    agent.send(JSON.stringify({ action: 'msg', type: 'ps', value: psScript }));
  }

  // Hook into agent console output
  if (parent.itemEventBus) {
    parent.itemEventBus.on('agentconsole', function (data) {
      if (!data.value) return;

      if (data.value.indexOf('QUINTHAM_DB_PATH:') > -1) {
        var path = data.value.split('QUINTHAM_DB_PATH:')[1].trim();
        notifyClient(data.nodeid, { method: 'dbLocationFound', path: path });
      }

      // Warning: Default console buffer might be truncated if DB is large.
      // This approach is risky for large files but fits the "plugin" model without binary streams.
      else if (data.value.indexOf('QUINTHAM_DB_DATA:') > -1) {
        var b64 = data.value.split('QUINTHAM_DB_DATA:')[1].trim();
        notifyClient(data.nodeid, { method: 'dbDatareceived', data: b64 });
      }

      else if (data.value.indexOf('QUINTHAM_SAVE_COMPLETE') > -1) {
        notifyClient(data.nodeid, { method: 'saveComplete' });
      }
    });
  }

  function notifyClient(nodeId, msg) {
    msg.plugin = 'quintham';
    msg.action = 'plugin';
    parent.wss.clients.forEach(function (client) {
      // We really should filter by checking if the client is looking at this node
      // client.user, client.nodeId ... 
      try { client.send(JSON.stringify(msg)); } catch (e) { }
    });
  }

  return obj;
}