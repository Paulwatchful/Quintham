/** 
* @description MeshCentral ScriptTask plugin
* @author Ryan Blenis
* @copyright 
* @license Apache-2.0
*/

"use strict";
var mesh;
var obj = this;
var _sessionid;
var isWsconnection = false;
var wscon = null;
var db = require('SimpleDataStore').Shared();
var pendingDownload = [];
var debug_flag = false;
var runningJobs = [];
var runningJobPIDs = {};

var dbg = function (str) {
    if (debug_flag !== true) return;
    var fs = require('fs');
    var logStream = fs.createWriteStream('scripttask.txt', { 'flags': 'a' });
    // use {'flags': 'a'} to append and {'flags': 'w'} to erase and write a new file
    logStream.write('\n' + new Date().toLocaleString() + ': ' + str);
    logStream.end('\n');
}

Array.prototype.remove = function (from, to) {
    var rest = this.slice((to || from) + 1 || this.length);
    this.length = from < 0 ? this.length + from : from;
    return this.push.apply(this, rest);
};

function consoleaction(args, rights, sessionid, parent) {
    isWsconnection = false;
    wscon = parent;
    var _sessionid = sessionid;
    if (typeof args['_'] == 'undefined') {
        args['_'] = [];
        args['_'][1] = args.pluginaction;
        args['_'][2] = null;
        args['_'][3] = null;
        args['_'][4] = null;
        isWsconnection = true;
    }

    var fnname = args['_'][1];
    mesh = parent;

    switch (fnname) {
        case 'triggerJob':
            var jObj = {
                jobId: args.jobId,
                scriptId: args.scriptId,
                replaceVars: args.replaceVars,
                scriptHash: args.scriptHash,
                dispatchTime: args.dispatchTime
            };
            //dbg('jObj args is ' + JSON.stringify(jObj));
            var sObj = getScriptFromCache(jObj.scriptId);
            //dbg('sobj = ' + JSON.stringify(sObj) + ', shash = ' + jObj.scriptHash);
            if (sObj == null || sObj.contentHash != jObj.scriptHash) {
                // get from the server, then run
                //dbg('Getting and caching script '+ jObj.scriptId);
                mesh.SendCommand({
                    "action": "plugin",
                    "plugin": "quintham",
                    "pluginaction": "getScript",
                    "scriptId": jObj.scriptId,
                    "sessionid": _sessionid,
                    "tag": "console"
                });
                pendingDownload.push(jObj);
            } else {
                // ready to run
                runScript(sObj, jObj);
            }
            break;
        case 'cacheScript':
            var sObj = args.script;
            cacheScript(sObj);
            var setRun = [];
            if (pendingDownload.length) {
                pendingDownload.forEach(function (pd, k) {
                    if (pd.scriptId == sObj._id && pd.scriptHash == sObj.contentHash) {
                        if (setRun.indexOf(pd) === -1) {
                            runScript(sObj, pd);
                            setRun.push(pd);
                        }
                        pendingDownload.remove(k);
                    }
                });
            }
            break;
        case 'clearAll':
            clearCache();
            mesh.SendCommand({
                "action": "plugin",
                "plugin": "quintham",
                "pluginaction": "clearAllPendingJobs",
                "sessionid": _sessionid,
                "tag": "console"
            });
            return 'Cache cleared. All pending jobs cleared.';
            break;
        case 'clearCache':
            clearCache();
            return 'The script cache has been cleared';
            break;
        case 'debug':
            debug_flag = (debug_flag) ? false : true;
            var str = (debug_flag) ? 'on' : 'off';
            return 'Debugging is now ' + str;
            break;
        case 'getPendingJobs':
            var ret = '';
            if (pendingDownload.length == 0) return "No jobs pending script download";
            pendingDownload.forEach(function (pd, k) {
                ret += 'Job ' + k + ': ' + 'JobID: ' + pd.jobId + ' ScriptID: ' + pd.scriptId;
            });
            return ret;
            break;
        case 'checkDatabase':
            var fs = require('fs');
            var exists = fs.existsSync(args.path);
            mesh.SendCommand({
                "action": "plugin",
                "plugin": "quintham",
                "pluginaction": "databaseResponse",
                "type": "check",
                "data": exists,
                "reqId": args.reqId,
                "sessionid": _sessionid,
                "tag": "console"
            });
            break;
        case 'readDatabase':
            var fs = require('fs');
            if (!fs.existsSync(args.path)) {
                sendError("File not found", args.reqId);
                return;
            }
            try {
                var content = fs.readFileSync(args.path, 'binary'); // Read as binary string
                // Convert to base64
                var b64 = Buffer.from(content, 'binary').toString('base64');
                mesh.SendCommand({
                    "action": "plugin",
                    "plugin": "quintham",
                    "pluginaction": "databaseResponse",
                    "type": "read",
                    "data": b64,
                    "reqId": args.reqId,
                    "sessionid": _sessionid,
                    "tag": "console"
                });
            } catch (e) { sendError(e.toString(), args.reqId); }
            break;
        case 'writeDatabase':
            var fs = require('fs');
            try {
                var b = Buffer.from(args.data, 'base64');
                fs.writeFileSync(args.path, b);
                mesh.SendCommand({
                    "action": "plugin",
                    "plugin": "quintham",
                    "pluginaction": "databaseResponse",
                    "type": "write",
                    "data": "success",
                    "reqId": args.reqId,
                    "sessionid": _sessionid,
                    "tag": "console"
                });
            } catch (e) { sendError(e.toString(), args.reqId); }
            break;
        case 'listDirectory':
            var fs = require('fs');
            // Manual path handling to avoid missing 'path' module
            var dir = args.path;

            // Basic path sanitization
            if (dir == '' || dir == null) {
                if (process.platform == 'win32') dir = 'C:\\';
                else dir = '/';
            }

            // Helper to join paths
            var joinPath = function (p1, p2) {
                var sep = (process.platform == 'win32') ? '\\' : '/';
                if (p1.endsWith('/') || p1.endsWith('\\')) return p1 + p2;
                return p1 + sep + p2;
            };

            try {
                fs.readdir(dir, function (err, files) {
                    if (err) {
                        sendError("Error reading directory: " + err, args.reqId);
                        return;
                    }
                    var fileList = [];
                    // Add parent directory option
                    if (dir.length > 3 || (process.platform != 'win32' && dir.length > 1)) {
                        // Simple parent calc
                        var parent = dir;
                        if (parent.endsWith('/') || parent.endsWith('\\')) parent = parent.slice(0, -1);
                        var lastSep = Math.max(parent.lastIndexOf('/'), parent.lastIndexOf('\\'));
                        if (lastSep > 0) parent = parent.substring(0, lastSep);
                        else if (process.platform == 'win32') parent = parent.substring(0, lastSep + 1); // Keep C:\
                        else parent = '/';

                        fileList.push({ name: '..', type: 'dir', path: parent });
                    }

                    var processing = files.length;
                    if (processing == 0) {
                        sendDirResponse(dir, fileList, args.reqId);
                        return;
                    }

                    var processNext = function (idx) {
                        if (idx >= files.length) {
                            sendDirResponse(dir, fileList, args.reqId);
                            return;
                        }
                        var f = files[idx];
                        var fullPath = joinPath(dir, f);
                        fs.stat(fullPath, function (err, stats) {
                            try {
                                if (!err) {
                                    fileList.push({
                                        name: f,
                                        type: (stats && stats.isDirectory && stats.isDirectory()) ? 'dir' : 'file',
                                        path: fullPath,
                                        size: (stats && stats.size) ? stats.size : 0
                                    });
                                }
                            } catch (e) { }
                            // Add a small yield to prevent blocking unrelated events for too long if needed, 
                            // though setImmediate/nextTick might not be available in strict shim environments. 
                            // Direct recursion here is async due to fs.stat callback, so stack won't overflow.
                            processNext(idx + 1);
                        });
                    };
                    processNext(0);
                });
            } catch (e) { sendError(e.toString(), args.reqId); }
            break;
        default:
            dbg('Unknown action: ' + fnname + ' with data ' + JSON.stringify(args));
            break;
    }
}

function finalizeJob(job, retVal, errVal) {
    if (errVal != null && errVal.stack != null) errVal = errVal.stack;
    runningJobs.remove(runningJobs.indexOf(job.jobId));
    if (typeof runningJobPIDs[job.jobId] != 'undefined') delete runningJobPIDs[job.jobId];
    mesh.SendCommand({
        "action": "plugin",
        "plugin": "quintham",
        "pluginaction": "jobComplete",
        "jobId": job.jobId,
        "scriptId": job.scriptId,
        "retVal": retVal,
        "errVal": errVal,
        "dispatchTime": job.dispatchTime, // include original run time (long running tasks could have tried a re-send)
        "sessionid": _sessionid,
        "tag": "console"
    });
}
//@TODO Test powershell on *nix devices with and without powershell installed
function runPowerShell(sObj, jObj) {
    if (process.platform != 'win32') return runPowerShellNonWin(sObj, jObj);
    const fs = require('fs');
    var rand = Math.random().toString(32).replace('0.', '');

    var oName = 'st' + rand + '.txt';
    var pName = 'st' + rand + '.ps1';
    var pwshout = '', pwsherr = '', cancontinue = false;
    try {
        fs.writeFileSync(pName, sObj.content);
        var outstr = '', errstr = '';
        var child = require('child_process').execFile(process.env['windir'] + '\\system32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy Bypass']);
        child.stderr.on('data', function (chunk) { errstr += chunk; });
        child.stdout.on('data', function (chunk) { });
        runningJobPIDs[jObj.jobId] = child.pid;
        child.stdin.write('.\\' + pName + ' | Out-File ' + oName + ' -Encoding UTF8\r\n');
        child.on('exit', function (procRetVal, procRetSignal) {
            dbg('Exiting with ' + procRetVal + ', Signal: ' + procRetSignal);
            if (errstr != '') {
                finalizeJob(jObj, null, errstr);
                try {
                    fs.unlinkSync(oName);
                    fs.unlinkSync(pName);
                } catch (e) { dbg('Could not unlink files, error was: ' + e); }
                return;
            }
            if (procRetVal == 1) {
                finalizeJob(jObj, null, 'Process terminated unexpectedly.');
                try {
                    fs.unlinkSync(oName);
                    fs.unlinkSync(pName);
                } catch (e) { dbg('Could not unlink files, error was: ' + e); }
                return;
            }
            try {
                outstr = fs.readFileSync(oName, 'utf8').toString();
            } catch (e) { outstr = (procRetVal) ? 'Failure' : 'Success'; }
            if (outstr) {
                //outstr = outstr.replace(/[^\x20-\x7E]/g, ''); 
                try { outstr = outstr.trim(); } catch (e) { }
            } else {
                outstr = (procRetVal) ? 'Failure' : 'Success';
            }
            dbg('Output is: ' + outstr);
            finalizeJob(jObj, outstr);
            try {
                fs.unlinkSync(oName);
                fs.unlinkSync(pName);
            } catch (e) { }
        });
        child.stdin.write('exit\r\n');
        //child.waitExit(); // this was causing the event loop to stall on long-running scripts, switched to '.on exit'

    } catch (e) {
        dbg('Error block was (PowerShell): ' + e);
        finalizeJob(jObj, null, e);
    }
}

function runPowerShellNonWin(sObj, jObj) {
    const fs = require('fs');
    var rand = Math.random().toString(32).replace('0.', '');

    var path = '';
    var pathTests = [
        '/usr/local/mesh',
        '/tmp',
        '/usr/local/mesh_services/meshagent',
        '/var/tmp'
    ];
    pathTests.forEach(function (p) {
        if (path == '' && fs.existsSync(p)) { path = p; }
    });
    dbg('Path chosen is: ' + path);
    path = path + '/';

    var oName = 'st' + rand + '.txt';
    var pName = 'st' + rand + '.ps1';
    var pwshout = '', pwsherr = '', cancontinue = false;
    try {
        var childp = require('child_process').execFile('/bin/sh', ['sh']);
        childp.stderr.on('data', function (chunk) { pwsherr += chunk; });
        childp.stdout.on('data', function (chunk) { pwshout += chunk; });
        childp.stdin.write('which pwsh' + '\n');
        childp.stdin.write('exit\n');
        childp.waitExit();
    } catch (e) { finalizeJob(jObj, null, "Couldn't determine pwsh in env: " + e); }
    if (pwsherr != '') {
        finalizeJob(jObj, null, "PowerShell env determination error: " + pwsherr);
        return;
    }
    if (pwshout.trim() != '') {
        cancontinue = true;
    }
    if (cancontinue === false) { finalizeJob(jObj, null, "PowerShell is not installed"); return; }
    try {
        fs.writeFileSync(path + pName, '#!' + pwshout + '\n' + sObj.content.split('\r\n').join('\n').split('\r').join('\n'));
        var outstr = '', errstr = '';
        var child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stderr.on('data', function (chunk) { errstr += chunk; });
        child.stdout.on('data', function (chunk) { });
        runningJobPIDs[jObj.jobId] = child.pid;

        child.stdin.write('cd ' + path + '\n');
        child.stdin.write('chmod a+x ' + pName + '\n');
        child.stdin.write('./' + pName + ' > ' + oName + '\n');
        child.on('exit', function (procRetVal, procRetSignal) {
            if (errstr != '') {
                finalizeJob(jObj, null, errstr);
                try {
                    fs.unlinkSync(path + oName);
                    fs.unlinkSync(path + pName);
                } catch (e) { dbg('Could not unlink files, error was: ' + e + ' for path ' + path); }
                return;
            }
            if (procRetVal == 1) {
                finalizeJob(jObj, null, 'Process terminated unexpectedly.');
                try {
                    fs.unlinkSync(path + oName);
                    fs.unlinkSync(path + pName);
                } catch (e) { dbg('Could not unlink files1, error was: ' + e + ' for path ' + path); }
                return;
            }
            try {
                outstr = fs.readFileSync(path + oName, 'utf8').toString();
            } catch (e) { outstr = (procRetVal) ? 'Failure' : 'Success'; }
            if (outstr) {
                //outstr = outstr.replace(/[^\x20-\x7E]/g, ''); 
                try { outstr = outstr.trim(); } catch (e) { }
            } else {
                outstr = (procRetVal) ? 'Failure' : 'Success';
            }
            dbg('Output is: ' + outstr);
            finalizeJob(jObj, outstr);
            try {
                fs.unlinkSync(path + oName);
                fs.unlinkSync(path + pName);
            } catch (e) { dbg('Could not unlink files2, error was: ' + e + ' for path ' + path); }
        });
        child.stdin.write('exit\n');
    } catch (e) {
        dbg('Error block was (PowerShellNonWin): ' + e);
        finalizeJob(jObj, null, e);
    }
}

function runBat(sObj, jObj) {
    if (process.platform != 'win32') {
        finalizeJob(jObj, null, 'Platform not supported.');
        return;
    }
    const fs = require('fs');
    var rand = Math.random().toString(32).replace('0.', '');
    var oName = 'st' + rand + '.txt';
    var pName = 'st' + rand + '.bat';
    try {
        fs.writeFileSync(pName, sObj.content);
        var outstr = '', errstr = '';
        var child = require('child_process').execFile(process.env['windir'] + '\\system32\\cmd.exe');
        child.stderr.on('data', function (chunk) { errstr += chunk; });
        child.stdout.on('data', function (chunk) { });
        runningJobPIDs[jObj.jobId] = child.pid;
        child.stdin.write(pName + ' > ' + oName + '\r\n');
        child.stdin.write('exit\r\n');

        child.on('exit', function (procRetVal, procRetSignal) {
            if (errstr != '') {
                try {
                    fs.unlinkSync(oName);
                    fs.unlinkSync(pName);
                } catch (e) { dbg('Could not unlink files, error was: ' + e); }
                finalizeJob(jObj, null, errstr);
                return;
            }
            if (procRetVal == 1) {
                try {
                    fs.unlinkSync(oName);
                    fs.unlinkSync(pName);
                } catch (e) { dbg('Could not unlink files, error was: ' + e); }
                finalizeJob(jObj, null, 'Process terminated unexpectedly.');
                return;
            }
            try {
                outstr = fs.readFileSync(oName, 'utf8').toString();
            } catch (e) { outstr = (procRetVal) ? 'Failure' : 'Success'; }
            if (outstr) {
                //outstr = outstr.replace(/[^\x20-\x7E]/g, ''); 
                try { outstr = outstr.trim(); } catch (e) { }
            } else {
                outstr = (procRetVal) ? 'Failure' : 'Success';
            }
            dbg('Output is: ' + outstr);
            try {
                fs.unlinkSync(oName);
                fs.unlinkSync(pName);
            } catch (e) { dbg('Could not unlink files, error was: ' + e); }
            finalizeJob(jObj, outstr);
        });
    } catch (e) {
        dbg('Error block was (BAT): ' + e);
        finalizeJob(jObj, null, e);
    }
}

function runBash(sObj, jObj) {
    if (process.platform == 'win32') {
        finalizeJob(jObj, null, 'Platform not supported.');
        return;
    }
    //dbg('proc is ' + JSON.stringify(process));
    const fs = require('fs');
    var path = '';
    var pathTests = [
        '/usr/local/mesh',
        '/tmp',
        '/usr/local/mesh_services/meshagent',
        '/var/tmp'
    ];
    pathTests.forEach(function (p) {
        if (path == '' && fs.existsSync(p)) { path = p; }
    });
    dbg('Path chosen is: ' + path);
    path = path + '/';
    //var child = require('child_process');
    //child.execFile(process.env['windir'] + '\\system32\\cmd.exe', ['/c', 'RunDll32.exe user32.dll,LockWorkStation'], { type: 1 });

    var rand = Math.random().toString(32).replace('0.', '');
    var oName = 'st' + rand + '.txt';
    var pName = 'st' + rand + '.sh';
    try {
        fs.writeFileSync(path + pName, sObj.content);
        var outstr = '', errstr = '';
        var child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stderr.on('data', function (chunk) { errstr += chunk; });
        child.stdout.on('data', function (chunk) { });
        runningJobPIDs[jObj.jobId] = child.pid;
        child.stdin.write('cd ' + path + '\n');
        child.stdin.write('chmod a+x ' + pName + '\n');
        child.stdin.write('./' + pName + ' > ' + oName + '\n');
        child.stdin.write('exit\n');

        child.on('exit', function (procRetVal, procRetSignal) {
            if (errstr != '') {
                try {
                    fs.unlinkSync(path + oName);
                    fs.unlinkSync(path + pName);
                } catch (e) { dbg('Could not unlink files, error was: ' + e + ' for path ' + path); }
                finalizeJob(jObj, null, errstr);
                return;
            }
            if (procRetVal == 1) {
                try {
                    fs.unlinkSync(path + oName);
                    fs.unlinkSync(path + pName);
                } catch (e) { dbg('Could not unlink files1, error was: ' + e + ' for path ' + path); }
                finalizeJob(jObj, null, 'Process terminated unexpectedly.');
                return;
            }
            try {
                outstr = fs.readFileSync(path + oName, 'utf8').toString();
            } catch (e) { outstr = (procRetVal) ? 'Failure' : 'Success'; }
            if (outstr) {
                //outstr = outstr.replace(/[^\x20-\x7E]/g, ''); 
                try { outstr = outstr.trim(); } catch (e) { }
            } else {
                outstr = (procRetVal) ? 'Failure' : 'Success';
            }
            dbg('Output is: ' + outstr);
            try {
                fs.unlinkSync(path + oName);
                fs.unlinkSync(path + pName);
            } catch (e) { dbg('Could not unlink files2, error was: ' + e + ' for path ' + path); }
            finalizeJob(jObj, outstr);
        });
    } catch (e) {
        dbg('Error block was (bash): ' + e);
        finalizeJob(jObj, null, e);
    }
}

function jobIsRunning(jObj) {
    if (runningJobs.indexOf(jObj.jobId) === -1) return false;
    return true;
}

function runScript(sObj, jObj) {
    // get current processes and clean running jobs if they are no longer running (computer fell asleep, user caused process to stop, etc.)
    if (process.platform != 'linux' && runningJobs.length) { // linux throws errors here in the meshagent for some reason
        require('process-manager').getProcesses(function (plist) {
            dbg('Got process list');
            dbg('There are currently ' + runningJobs.length + ' running jobs.');
            if (runningJobs.length) {
                runningJobs.forEach(function (jobId, idx) {
                    dbg('Checking for running job: ' + jobId + ' with PID ' + runningJobPIDs[jobId]);
                    if (typeof plist[runningJobPIDs[jobId]] == 'undefined' || typeof plist[runningJobPIDs[jobId]].cmd != 'string') {
                        dbg('Found job with no process. Removing running status.');
                        delete runningJobPIDs[jobId];
                        runningJobs.remove(runningJobs.indexOf(idx));
                        //dbg('RunningJobs: ' + JSON.stringify(runningJobs));
                        //dbg('RunningJobsPIDs: ' + JSON.stringify(runningJobPIDs));
                    }
                });
            }
        });
    }
    if (jobIsRunning(jObj)) { dbg('Job already running job id [' + jObj.jobId + ']. Skipping.'); return; }
    if (jObj.replaceVars != null) {
        Object.getOwnPropertyNames(jObj.replaceVars).forEach(function (key) {
            var val = jObj.replaceVars[key];
            sObj.content = sObj.content.replace(new RegExp('#' + key + '#', 'g'), val);
            dbg('replacing var ' + key + ' with ' + val);
        });
        sObj.content = sObj.content.replace(new RegExp('#(.*?)#', 'g'), 'VAR_NOT_FOUND');
    }
    runningJobs.push(jObj.jobId);
    dbg('Running Script ' + sObj._id);
    switch (sObj.filetype) {
        case 'ps1':
            runPowerShell(sObj, jObj);
            break;
        case 'bat':
            runBat(sObj, jObj);
            break;
        case 'bash':
            runBash(sObj, jObj);
            break;
        default:
            dbg('Unknown filetype: ' + sObj.filetype);
            break;
    }
}
function getScriptFromCache(id) {
    var script = db.Get('pluginQuintham_script_' + id);
    if (script == '' || script == null) return null;
    try {
        script = JSON.parse(script);
    } catch (e) { return null; }
    return script;
}
function cacheScript(sObj) {
    db.Put('pluginQuintham_script_' + sObj._id, sObj);
}
function clearCache() {
    db.Keys.forEach(function (k) {
        if (k.indexOf('pluginQuintham_script_') === 0) {
            db.Put(k, null);
            db.Delete(k);
        }
    });
}

function sendConsoleText(text, sessionid) {
    if (typeof text == 'object') { text = JSON.stringify(text); }
    mesh.SendCommand({ "action": "msg", "type": "console", "value": text, "sessionid": sessionid });
}

function sendDirResponse(dir, files, reqId) {
    mesh.SendCommand({
        "action": "plugin",
        "plugin": "quintham",
        "pluginaction": "databaseResponse",
        "type": "directory",
        "data": { path: dir, files: files },
        "reqId": reqId,
        "tag": "console"
    });
}

module.exports = { consoleaction: consoleaction };

function sendError(msg, reqId) {
    mesh.SendCommand({
        "action": "plugin",
        "plugin": "quintham",
        "pluginaction": "databaseResponse",
        "error": msg,
        "reqId": reqId,
        "tag": "console"
    });
}
