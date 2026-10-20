-- =============================================================
-- 063 — Accurate port coordinates + two port renames
--
-- Coordinates pasted from Google Maps (plus codes) by the user on
-- 2026-10-21. Routes and island-hop packages reference port IDs, so
-- the renames are safe.
--
-- Run manually in the SQL editor, after 062.
-- No demo reset.
-- =============================================================

UPDATE ports SET latitude = 10.302248565164343, longitude = 124.01847709064677,
  location = 'Mactan, Lapu-Lapu, Cebu'          WHERE id = 'angasil';

UPDATE ports SET latitude = 10.257738477431813, longitude = 123.98169917640763,
  location = 'Subabasbas, Lapu-Lapu, Cebu'      WHERE id = 'marigondon';

UPDATE ports SET latitude = 10.310178525635642, longitude = 124.0248526292095,
  location = 'Punta Engaño Rd, Lapu-Lapu, Cebu' WHERE id = 'hilton';

UPDATE ports SET latitude = 10.283156362022243, longitude = 123.99919692357389,
  location = 'Pajac-Maribago Rd, Maribago, Lapu-Lapu, Cebu' WHERE id = 'maribago';

UPDATE ports SET latitude = 10.203648352700752, longitude = 124.01805085767555,
  location = 'Lapu-Lapu, Cebu'                  WHERE id = 'caohagan';

UPDATE ports SET latitude = 10.237860042382632, longitude = 124.01101458830962,
  location = 'Lapu-Lapu, Cebu'                  WHERE id = 'sulpa';

UPDATE ports SET port_name = 'Santa Rosa Port, Olango Island',
  latitude = 10.273348654264161, longitude = 124.04200728500881,
  location = 'Santa Rosa, Lapu-Lapu, Cebu'      WHERE id = 'st-vicente';

UPDATE ports SET port_name = 'Gilutongan Island',
  latitude = 10.207627234911527, longitude = 123.98867432525823,
  location = 'Gilutongan, Cordova, Cebu'        WHERE id = 'hilotongan';

UPDATE ports SET latitude = 10.19008710219929, longitude = 124.00052193484703,
  location = 'Cordova, Cebu'                    WHERE id = 'nalusuan';

-- Verify: SELECT id, port_name, latitude, longitude FROM ports ORDER BY sort_order;
