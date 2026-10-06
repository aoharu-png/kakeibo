/* Tesseract worker wrapper: language data is shipped as base64 text so it can be served as a plain text file */
(function () {
  var realFetch = self.fetch.bind(self);
  self.fetch = function (url, opts) {
    var u = String(url);
    if (/jpn\.traineddata(\.gz)?$/.test(u)) {
      return realFetch(new URL("lang/jpn.traineddata.b64.txt", self.location.href).href).then(function (r) {
        if (!r.ok) throw new Error("language data " + r.status);
        return r.text();
      }).then(function (b64) {
        var bin = atob(b64.trim()), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Response(bytes, { status: 200 });
      });
    }
    return realFetch(url, opts);
  };
  importScripts("worker.min.js");
})();
