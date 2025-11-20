/*
Copyright (c) 2025 Steve LLamb (https://github.com/SteveLLamb) and PrZ3(https://github.com/PrZ3r)

Redistribution and use in source and binary forms, with or without modification, 
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

3. Redistributions in binary form must reproduce the above copyright notice, this
   list of conditions and the following disclaimer in the documentation and/or
   other materials provided with the distribution.

4. Neither the name of the copyright holder nor the names of its contributors may
   be used to endorse or promote products derived from this software without specific 
   prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND 
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED 
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE 
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL 
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR 
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER 
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR 
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF 
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/* Filter accross all collumns in table */

$(document).ready(function(){
  $("#search").on("input", function() {
    var value = $(this).val().toLowerCase();
    $("#searchTable tr").filter(function() {
      $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1)
    });
  });
});

/* Clear filtering */

$(document).on('click', '.clear-filter', function(){       

  var docTable = $('#sorttableDocs').DataTable();
  docTable
   .search( '' )
   .columns().search( '' )
   .draw();

  $('#sorttableDocs').DataTable().searchPanes.clearSelections();
  $('#sorttableDocs').DataTable().order([1, 'asc']).draw();

  var groupTable = $('#sorttableGroups').DataTable();
  groupTable
   .search( '' )
   .columns().search( '' )
   .draw();

  $('#sorttableGroups').DataTable().searchPanes.clearSelections();
  $('#sorttableGroups').DataTable().order([0, 'asc']).draw();

  var groupProj = $('#sorttableProjs').DataTable();
  groupProj
   .search( '' )
   .columns().search( '' )
   .draw();

  $('#sorttableProjs').DataTable().searchPanes.clearSelections();
  $('#sorttableProjs').DataTable().order([0, 'asc']).draw();

  var url= document.location.href;
  window.history.pushState({}, "", url.split("?")[0]);

});

/* DataTable options for sort headers and filtering - Groups*/

$(document).ready(function() {

  var searchOptions = $.fn.dataTable.ext.deepLink( ['search.search' ] );

  var defaultOptions = {
    autoWidth: false,
    paging: false,
    pageLength: 25,
    lengthMenu: [[5, 10, 25, 50, -1], [5, 10, 25, 50, "All"]], 
    responsive: true,
    buttons: [
      {
        extend: 'searchPanes',
        config:{
          cascadePanes: true,
          emptyMessage:"<i><b>None Defined</b></i>",
          dtOpts: {
            select: {
                style: 'multi'
            }
          }, 
          layout: 'columns-4',
          viewTotal: true,
          columns: [1, 7, 3, 4]
        }
      },
      {
        text: 'Clear All Filters',
        action: function ( e, dt, node, config ) {
          var table = $('#sorttableGroups').DataTable();
          table
           .search( '' )
           .columns().search( '' )
           .draw();

          $('#sorttableGroups').DataTable().searchPanes.clearSelections();
          $('#sorttableGroups').DataTable().order([0, 'asc']).draw();

          var url= document.location.href;
          window.history.pushState({}, "", url.split("?")[0]);
        }
      }
    ],
    columnDefs:[
      {
        width: '16.6%',
        targets:[2]
      },
      {
        width: '20%',
        targets:[6]
      },
      {
        visible: true,
        targets:[7],
        searchPanes: {
          header: "Technical Committee"
        }
      },
      {
        width: '16.6%',
        targets:[8]
      }
    ],
    dom: 
      "<'row'<'col d-print-none d-flex align-items-center'B><'col d-flex justify-content-center align-items-center'i><'col d-print-none d-flex justify-content-end align-items-center'f>>" +
      "<'row'<'col-sm-12't>>" +
      "<'row'<'col-sm-12'lp>>",
    language: {
      processing: "Loading filtering options...",
      searchPanes: {
        collapse: {0: 'Filter Options', _: 'Filter Options (%d)'}
      }
    }
  };

  var dt = $('#sorttableGroups').DataTable( 
    $.extend( defaultOptions, searchOptions )
  );

});

/* DataTable options for sort headers and filtering - Projects*/

$(document).ready(function() {

  var searchOptions = $.fn.dataTable.ext.deepLink( ['search.search' ] );

  var defaultOptions = {
    autoWidth: false,
    paging: false,
    pageLength: 25,
    lengthMenu: [[5, 10, 25, 50, -1], [5, 10, 25, 50, "All"]], 
    responsive: false,
    buttons: [
      {
        extend: 'searchPanes',
        config:{
          cascadePanes: true,
          emptyMessage:"<i><b>None Defined</b></i>",
          dtOpts: {
            select: {
                style: 'multi'
            }
          }, 
          layout: 'columns-3',
          viewTotal: true,
          columns: [6, 2, 4]
        }
      },
      {
        text: 'Clear All Filters',
        action: function ( e, dt, node, config ) {
          var table = $('#sorttableProjs').DataTable();
          table
           .search( '' )
           .columns().search( '' )
           .draw();

          $('#sorttableProjs').DataTable().searchPanes.clearSelections();
          $('#sorttableProjs').DataTable().order([0, 'asc']).draw();

          var url= document.location.href;
          window.history.pushState({}, "", url.split("?")[0]);
        }
      }
    ],
    dom: 
      "<'row'<'col d-print-none d-flex align-items-center'B><'col d-flex justify-content-center align-items-center'i><'col d-print-none d-flex justify-content-end align-items-center'f>>" +
      "<'row'<'col-sm-12't>>" +
      "<'row'<'col-sm-12'lp>>",
    language: {
      processing: "Loading filtering options...",
      searchPanes: {
        collapse: {0: 'Filter Options', _: 'Filter Options (%d)'}
      }
    },
    columnDefs:[

      {
        visible: false,
        targets:[4],
        searchPanes: {
          header: "Status"
        }
      },
      {
        visible: false,
        targets:[6],
        searchPanes: {
          header: "Group"
        }
      }
    ]
  }

  var dt = $('#sorttableProjs').DataTable( 
    $.extend( defaultOptions, searchOptions )
  );

});

/* "Back To Top" button functionality */

$(document).ready(function() {
$(window).scroll(function() {
if ($(this).scrollTop() > 20) {
$('#toTopBtn').fadeIn();
} else {
$('#toTopBtn').fadeOut();
}
});

// Native smooth scroll (starts immediately, avoids jQuery animation queue)
$(document).on('click', '#toTopBtn', function(e){
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  return false;
});
});

/* Dynamic navbar active state based on current URL vs nav hrefs */
$(document).ready(function () {
  try {
    var here = window.location && window.location.href ? window.location.href : '';
    if (!here) return;

    // Normalize common index.html endings for comparison
    here = here.replace(/\/index\.html([?#].*)?$/, '/$1');

    var navLinks = document.querySelectorAll('.navbar .nav-link[id^="nav-"]');
    var bestMatch = null;
    var bestLen = 0;

    navLinks.forEach(function (link) {
      if (!link || !link.href) return;
      var href = link.href;

      // Normalize link href similarly
      href = href.replace(/\/index\.html([?#].*)?$/, '/$1');

      // We want the longest href that is a prefix of the current URL
      if (here.indexOf(href) === 0 && href.length > bestLen) {
        bestMatch = link;
        bestLen = href.length;
      }
    });

    // If nothing matched as a prefix, fall back to home if present
    if (!bestMatch) {
      bestMatch = document.getElementById('nav-home');
    }

    if (bestMatch) {
      bestMatch.classList.add('active');
    }
  } catch (e) {
    if (window && window.console && console.warn) {
      console.warn('[msrbot] Failed to set active nav link:', e);
    }
  }
});