public with sharing class OrderController {
    
    @AuraEnabled
    public static Boolean getOrderRecord(String orderNumber) {
        try {
            List<Order> orders = [SELECT Id FROM Order WHERE OrderNumber = :orderNumber LIMIT 1];
            return !orders.isEmpty();
        } catch (Exception e) {
            throw new AuraHandledException('Error retrieving order: ' + e.getMessage());
        }
    }
    
    @AuraEnabled
    public static String updateOrder(String orderNumber, String outboundTracking, String inboundTracking) {
        try {
            // Query for the order - this is likely line 21 causing the issue
            List<Order> orderList = [SELECT Id, Cooler_Reaches__c, Cooler_Send_Date__c, Cooler_Back_To_Processing__c, 
                                   Cooler_Received_Date__c, Machine__c, Actual_Weight_oz__c,
                                   Outbound_Tracking_Nmber__c, Inbound_Tracking_Number__c
                                   FROM Order WHERE OrderNumber = :orderNumber LIMIT 1];
            
            if (orderList.isEmpty()) {
                throw new AuraHandledException('Order not found');
            }
            
            Order orderRecord = orderList[0];
            
            // Update tracking numbers
            if (outboundTracking != null) {
                orderRecord.Outbound_Tracking_Nmber__c = outboundTracking;
            }
            if (inboundTracking != null) {
                orderRecord.Inbound_Tracking_Number__c = inboundTracking;
            }
            
            // Check if cooler has already reached and is coming back
            if (orderRecord.Cooler_Reaches__c == true && orderRecord.Cooler_Send_Date__c != null) {
                // Cooler is coming back to processing
                orderRecord.Cooler_Back_To_Processing__c = true;
                orderRecord.Cooler_Received_Date__c = System.now();
            } else {
                // First time sending cooler
                orderRecord.Cooler_Reaches__c = true;
                orderRecord.Cooler_Send_Date__c = System.now();
                
                // Create machine job if machine is assigned and available
                createMachineJobIfPossible(orderRecord);
            }
            
            update orderRecord;
            
            return 'Order updated successfully';
            
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException('Error updating order: ' + e.getMessage());
        }
    }
    
    private static void createMachineJobIfPossible(Order orderRecord) {
        if (orderRecord.Machine__c == null) {
            return; // No machine assigned
        }
        
        // Check if assigned machine is available
        List<Machine__c> assignedMachine = [SELECT Id, Open_to_Schedule__c, Capacity_oz__c, Next_Available_Date__c 
                                          FROM Machine__c 
                                          WHERE Id = :orderRecord.Machine__c AND Open_to_Schedule__c = true LIMIT 1];
        
        if (!assignedMachine.isEmpty()) {
            Machine_Job__c job = new Machine_Job__c(
                Order__c = orderRecord.Id,
                Machine__c = orderRecord.Machine__c
            );
            insert job;
        } else {
            // Try to find any available machine
            List<Machine__c> availableMachines = [SELECT Id, Capacity_oz__c, Next_Available_Date__c 
                                                FROM Machine__c 
                                                WHERE Open_to_Schedule__c = true 
                                                AND Capacity_oz__c >= :orderRecord.Actual_Weight_oz__c
                                                ORDER BY Next_Available_Date__c ASC LIMIT 1];
            
            if (!availableMachines.isEmpty()) {
                Machine_Job__c job = new Machine_Job__c(
                    Order__c = orderRecord.Id,
                    Machine__c = availableMachines[0].Id
                );
                insert job;
            }
        }
    }
}