/** 
 * Quintham Plugin Client-Side Script
 * Injected into MeshCentral to provide UI extensions.
 */

plugin_quintham = {
    onDeviceRefreshEnd: function (node, user, panel, overlay) {
        if (panel !== 3) return; // Only show on General tab (usually panel 3 or check context)

        var container = document.getElementById('quintham_controls');
        if (!container) {
            // Find a place to inject. 'p3default' is often the main ID for the general tab content.
            var parentElem = document.getElementById('p3default');
            if (parentElem) {
                var div = document.createElement('div');
                div.id = 'quintham_controls';
                div.className = 'panel panel-default';
                div.style.marginTop = '10px';
                div.innerHTML = `
                    <div class="panel-heading"><h3 class="panel-title">Quintham Toolkit</h3></div>
                    <div class="panel-body">
                        <div>
                            <strong>Database Status:</strong> <span id="quintham_db_path">Unknown</span>
                        </div>
                        <br/>
                        <button class="btn btn-default" onclick="plugin_quintham.findDb()">Find Database Location</button>
                        <button class="btn btn-default" onclick="plugin_quintham.downloadDb()">Download Database</button>
                        <hr/>
                        <button class="btn btn-warning" onclick="plugin_quintham.updateApp()">Update App</button>
                    </div>
                `;
                parentElem.appendChild(div);
            }
        }
    },

    findDb: function () {
        meshcentral.send({ action: 'plugin', plugin: 'quintham', method: 'findDb', nodeId: currentNode._id });
        plugin_quintham.showMessage('Searching for database...');
    },

    downloadDb: function () {
        // Logic to trigger download
        // This might require a valid path first
        meshcentral.send({ action: 'plugin', plugin: 'quintham', method: 'downloadDb', nodeId: currentNode._id });
    },

    updateApp: function () {
        if (!confirm('Update Quintham App on this device?')) return;
        meshcentral.send({ action: 'plugin', plugin: 'quintham', method: 'updateApp', nodeId: currentNode._id });
        plugin_quintham.showMessage('Update command sent.');
    },

    showMessage: function (msg) {
        // Simple toast or log
        console.log('Quintham:', msg);
        if (typeof showToast === 'function') showToast(msg);
    }
};
