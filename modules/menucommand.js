var EXPORTED_SYMBOLS = [
    'MenuCommandEventNameSuffix',
    'MenuCommandListRequest', 'MenuCommandRespond',
    'MenuCommandRun', 'MenuCommandSandbox',
    ];


var Cc = Components.classes;
var Ci = Components.interfaces;
var Cu = Components.utils;


Components.utils.import('chrome://greasemonkey-modules/content/prefmanager.js');


var MenuCommandEventNameSuffix = (function() {
  var suffix = GM_prefRoot.getValue('menuCommanderEventNameSuffix');
  if (!suffix) {
    Cu.import("resource://services-crypto/utils.js");
    suffix = CryptoUtils.sha1Base32(CryptoUtils.generateRandomBytes(128));
    GM_prefRoot.setValue('menuCommanderEventNameSuffix', suffix);
  }
  return suffix;
})();


// Frame scope: Pass "list menu commands" message into sandbox as event.
function MenuCommandListRequest(aContent, aMessage) {
  var e = new aContent.CustomEvent(
      'greasemonkey-menu-command-list-' + MenuCommandEventNameSuffix,
      {'detail': aMessage.data.cookie});
  aContent.dispatchEvent(e);
}


// Callback from script scope, pass "list menu commands" response up to
// parent process as a message.
function MenuCommandRespond(aCookie, aData) {
  var cpmm = Cc["@mozilla.org/childprocessmessagemanager;1"]
      .getService(Ci.nsIMessageSender);
  cpmm.sendAsyncMessage(
      'greasemonkey:menu-command-response',
      {'commands': aData, 'cookie': aCookie});
}


// Frame scope: Respond to the "run this menu command" message coming
// from the parent, pass it into the sandbox.
function MenuCommandRun(aContent, aMessage) {
  var e = new aContent.CustomEvent(
      'greasemonkey-menu-command-run-' + MenuCommandEventNameSuffix,
      {'detail': JSON.stringify(aMessage.data)});
  aContent.dispatchEvent(e);
}


// This function is injected into the sandbox, in a private scope wrapper, BY
// SOURCE.  Data and sensitive references are wrapped up inside its closure.
function MenuCommandSandbox(
    aScriptUuid, aScriptName, aCommandResponder, aInvalidAccesskeyErrorStr,
    aMenuCommandEventNameSuffix) {
  // 1) Internally to this function's private scope, maintain a set of
  // registered menu commands.
  var commands = {};
  var commandFuncs = {};
  var commandCookie = 0;
  // 2) Respond to requests to list those registered commands.
  addEventListener(
      'greasemonkey-menu-command-list-' + aMenuCommandEventNameSuffix,
      function(e) {
        e.stopPropagation();
        aCommandResponder(e.detail, commands);
      }, true);
  // 3) Respond to requests to run those registered commands.
  addEventListener(
      'greasemonkey-menu-command-run-' + aMenuCommandEventNameSuffix,
      function(e) {
        e.stopPropagation();
        var detail = JSON.parse(e.detail);
        if (aScriptUuid != detail.scriptUuid) return;
        // This event is for this script; stop propagating to other scripts.
        e.stopImmediatePropagation();
        var commandFunc = commandFuncs[detail.cookie];
        if (!commandFunc) {
          throw new Error('Could not run requested menu command!');
        } else {
          commandFunc.call();
        }
      }, true);
  // 4) Export the "register a command" API function to the sandbox scope.
  this.GM_registerMenuCommand = function(
      commandName, commandFunc, accessKey, unused, accessKey2) {
    // Legacy support: if all five parameters were specified, (from when two
    // were for accelerators) use the last one as the access key.
    if ('undefined' != typeof accessKey2) {
      accessKey = accessKey2;
    }

    if (accessKey
        && (("string" != typeof accessKey) || (accessKey.length != 1))
    ) {
      throw new Error(aInvalidAccesskeyErrorStr.replace('%1', commandName));
    }

    var command = {
      cookie: ++commandCookie,
      name: commandName,
      scriptName: aScriptName,
      scriptUuid: aScriptUuid,
      accessKey: accessKey,
    };
    commands[command.cookie] = command;
    commandFuncs[command.cookie] = commandFunc;
  };
}
