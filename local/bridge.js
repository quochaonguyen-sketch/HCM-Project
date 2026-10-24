(function () {
  function runner(success, failure, userObject) {
    return new Proxy({}, { get: function (_, method) {
      if (method === 'withSuccessHandler') return function (fn) { return runner(fn, failure, userObject); };
      if (method === 'withFailureHandler') return function (fn) { return runner(success, fn, userObject); };
      if (method === 'withUserObject') return function (obj) { return runner(success, failure, obj); };
      if (method === 'then') return undefined;
      return function () {
        var args = Array.prototype.slice.call(arguments);
        fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: method, args: args }) })
          .then(function (r) { return r.json().then(function (data) { if (!r.ok) throw Error(data.error); return data; }); })
          .then(function (data) { if (success) success(data, userObject); })
          .catch(function (error) { if (failure) failure(error, userObject); else console.error(error); });
      };
    } });
  }
  window.google = {
    script: {
      run: runner(),
      host: { close: function () {}, setHeight: function () {}, setWidth: function () {} },
      url: {
        getLocation: function (fn) {
          fn({ hash: location.hash.slice(1), parameter: {}, parameters: {} });
        }
      }
    }
  };
  document.addEventListener('DOMContentLoaded', function () {
    var badge = document.createElement('div');
    var info=window.__LOCAL_DATA__||{};
    badge.textContent = 'LOCAL · Excel + MOCK · '+(info.hubs||0)+' HUBs · Không kết nối production';
    badge.title = 'Dữ liệu từ hai file Excel. Các ô/dòng thiếu và nguồn BigQuery dùng MOCK. Xem /api/local-data để kiểm tra nguồn.';
    badge.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#9a3412;color:white;text-align:center;font:12px Arial;padding:5px;pointer-events:none';
    document.body.appendChild(badge);
  });
})();
