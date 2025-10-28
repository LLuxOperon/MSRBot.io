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
      "<'row'<'col-sm-12't>>",
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
      "<'row'<'col-sm-12't>>",
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

/* DataTable options for sort headers and filtering - Documents*/

$(document).ready(function() {

  var searchOptions = $.fn.dataTable.ext.deepLink( ['search.search' ] );

  var defaultOptions = {
    paging: false,
    processing: true,
    responsive: true,
    order: [[0, 'asc']],   
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
          layout: 'columns-6',
          viewTotal: true,
          columns: [2, 4, 5, 6, 7, 9]
        }
      },
      {
        text: 'Clear All Filters',
        action: function ( e, dt, node, config ) {
          var table = $('#sorttableDocs').DataTable();
          table
           .search( '' )
           .columns().search( '' )
           .draw();

          $('#sorttableDocs').DataTable().searchPanes.clearSelections();
          $('#sorttableDocs').DataTable().order([1, 'asc']).draw();

          var url= document.location.href;
          window.history.pushState({}, "", url.split("?")[0]);
        }
      }
    ],
    dom: 
      "<'row'<'col d-print-none d-flex align-items-center'B><'col d-flex justify-content-center align-items-center'i><'col d-print-none d-flex justify-content-end align-items-center'f>>" +
      "<'row'<'col-sm-12't>>",
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
          header: "Group"
        }
      },
      {
        searchPanes: {
          orthogonal: 'sp'
        },
        render: function (data, type, row) {
          if (type === 'sp') {
            var keywords = [];
            $( $(data), "i" ).each(function( index ) {
              var val = $( this ).text();
              val = val.trim();
              if (val.length > 0) {
                keywords.push(val);
              }
            });
            return keywords;
            }
          return data;
        },
        targets:[6]
      },
      {
        searchPanes: {
          options:[
            {
              label: 'Active',
              value: function(rowData, rowIdx){
                return rowData[7].includes('[ ACTIVE ]');
              }
            },
            {
              label: 'Amended',
              value: function(rowData, rowIdx){
                return rowData[7].includes('[ AMENDED ]');
              }
            },
            {
              label: 'Draft',
              value: function(rowData, rowIdx){
                return rowData[7].includes('[ DRAFT ]');
              }
            },
            {
              label: 'Public CD',
              value: function(rowData, rowIdx){
                return rowData[7].includes('[ PUBLIC CD ]');
              }
            },
            {
              label: 'Reaffirmed',
              value: function(rowData, rowIdx){
                return rowData[7].includes('[ REAFFIRMED ]');
              }
            },
            {
              label: 'Stabilized',
              value: function(rowData, rowIdx){
                return rowData[7].includes('[ STABILIZED ]');
              }
            },
            {
              label: 'Superseded',
              value: function(rowData, rowIdx){
                return rowData[7].includes('[ SUPERSEDED ]');
              }
            },
            {
              label: 'Unknown',
              value: function(rowData, rowIdx){
                return rowData[7].includes('[ UNKNOWN ]');
              }
            },
            {
              label: 'Withdrawn',
              value: function(rowData, rowIdx){
                return rowData[7].includes('[ WITHDRAWN ]');
              }
            }
          ]
        },
        targets: [7]
      },
      {
        width: '25%',
        targets: [8]
      },
      {
        visible: false,
        searchPanes: {
          header: "Current Work",
          orthogonal: 'sp'
        },
        render: function (data, type, row) {
          if (type === 'sp') {
            var currentWork = [];
            $( $(data), "i" ).each(function( index ) {
              var val2 = $( this ).text();

              val2 = val2.trim();
              if (val2.length > 0) {
                currentWork.push(val2);
              }
            });
            return currentWork;
            }
          return data;
        },
        targets:[9]
      }
    ]
  }

  var dt = $('#sorttableDocs').DataTable( 
    $.extend( defaultOptions, searchOptions )
  );

});

/* DataTable options for sort headers and filtering - Dependancies */

$(document).ready(function() {

  var searchOptions = $.fn.dataTable.ext.deepLink( ['search.search' ] );

  var defaultOptions = {
    paging: false,
    processing: true,
    responsive: true,
    order: [[0, 'asc']],   
    buttons: [
     
      {
        text: 'Clear All Filters',
        action: function ( e, dt, node, config ) {
          var table = $('#sorttableDep').DataTable();
          table
           .search( '' )
           .columns().search( '' )
           .draw();

          $('#sorttableDep').DataTable().searchPanes.clearSelections();
          $('#sorttableDep').DataTable().order([1, 'asc']).draw();

          var url= document.location.href;
          window.history.pushState({}, "", url.split("?")[0]);
        }
      }
    ],
    dom: 
      "<'row'<'col d-print-none d-flex align-items-center'B><'col d-flex justify-content-center align-items-center'i><'col d-print-none d-flex justify-content-end align-items-center'f>>" +
      "<'row'<'col-sm-12't>>",
    language: {
      processing: "Loading filtering options...",
      searchPanes: {
        collapse: {0: 'Filter Options', _: 'Filter Options (%d)'}
      }
    }
  }

  var dt = $('#sorttableDep').DataTable( 
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

$('#toTopBtn').click(function() {
$("html, body").animate({
scrollTop: 0
}, 1000);
return false;
});
});