const { withInfoPlist } = require('expo/config-plugins');
module.exports = (config, { allowLocalHttp = false } = {}) =>
  withInfoPlist(config, (mod) => {
    const ats = { ...(mod.modResults.NSAppTransportSecurity || {}) };
    // Fine-grained ATS flags override NSAllowsArbitraryLoads on iOS. Local-only
    // internal builds allow IP-address HTTP; the app validates private URLs.
    if (allowLocalHttp) {
      delete ats.NSAllowsLocalNetworking;
      delete ats.NSAllowsArbitraryLoadsInWebContent;
      delete ats.NSAllowsArbitraryLoadsForMedia;
      ats.NSAllowsArbitraryLoads = true;
    } else {
      ats.NSAllowsArbitraryLoads = false;
      delete ats.NSAllowsLocalNetworking;
    }
    mod.modResults.NSAppTransportSecurity = ats;
    return mod;
  });
