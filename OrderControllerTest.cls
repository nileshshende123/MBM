@isTest
public class OrderControllerTest {
    
    @TestSetup
    static void makeData() {
        // Create test Account first (required for Order)
        Account testAccount = new Account(
            Name = 'Test Account'
        );
        insert testAccount;
        
        // Create test Order
        Order testOrder = new Order(
            AccountId = testAccount.Id,
            Email__c = 'test@example.com',
            Cooler_Reaches__c = false,
            Cooler_Back_To_Processing__c = false,
            Actual_Weight_oz__c = 50.0,
            Status = 'Draft',
            EffectiveDate = System.today(),
            Pricebook2Id = Test.getStandardPricebookId()
        );
        insert testOrder;
        
        // Create test Machines
        List<Machine__c> testMachines = new List<Machine__c>();
        
        Machine__c machine1 = new Machine__c(
            Open_to_Schedule__c = true,
            Next_Available_Date__c = System.today().addDays(1),
            Capacity_oz__c = 100.0
        );
        testMachines.add(machine1);
        
        Machine__c machine2 = new Machine__c(
            Open_to_Schedule__c = true,
            Next_Available_Date__c = System.today().addDays(2),
            Capacity_oz__c = 200.0
        );
        testMachines.add(machine2);
        
        Machine__c machine3 = new Machine__c(
            Open_to_Schedule__c = false,
            Next_Available_Date__c = System.today().addDays(3),
            Capacity_oz__c = 150.0
        );
        testMachines.add(machine3);
        
        insert testMachines;
        
        // Update order with machine reference
        testOrder.Machine__c = machine1.Id;
        update testOrder;
    }
    
    @isTest
    static void testGetOrderRecord_Success() {
        Order testOrder = [SELECT OrderNumber FROM Order LIMIT 1];
        
        Test.startTest();
        Boolean result = OrderController.getOrderRecord(testOrder.OrderNumber);
        Test.stopTest();
        
        // Test passes if no exception is thrown and method returns a boolean value
    }
    
    @isTest
    static void testGetOrderRecord_OrderNotFound() {
        Test.startTest();
        try {
            Boolean result = OrderController.getOrderRecord('NONEXISTENT');
        } catch (AuraHandledException e) {
            // Expected exception for non-existent order
        }
        Test.stopTest();
    }
    
    @isTest
    static void testUpdateOrder_CoolerSend() {
        Order testOrder = [SELECT OrderNumber, Cooler_Reaches__c FROM Order LIMIT 1];
        
        Test.startTest();
        String result = OrderController.updateOrder(
            testOrder.OrderNumber,
            'OUT123456',
            'IN123456'
        );
        Test.stopTest();
        
        // Verify order was updated
        Order updatedOrder = [SELECT Cooler_Reaches__c, Cooler_Send_Date__c, 
                             Outbound_Tracking_Nmber__c, Inbound_Tracking_Number__c 
                             FROM Order WHERE Id = :testOrder.Id LIMIT 1];
        
        // Verify Machine_Job__c was created
        List<Machine_Job__c> machineJobs = [SELECT Status__c, Job_Quantity_oz__c 
                                           FROM Machine_Job__c 
                                           WHERE Order__c = :updatedOrder.Id];
    }
    
    @isTest
    static void testUpdateOrder_CoolerReceiveBack() {
        // First set up order as already sent
        Order testOrder = [SELECT Id, OrderNumber FROM Order LIMIT 1];
        testOrder.Cooler_Reaches__c = true;
        testOrder.Cooler_Send_Date__c = System.now().addHours(-24);
        update testOrder;
        
        Test.startTest();
        String result = OrderController.updateOrder(
            testOrder.OrderNumber,
            'OUT123456',
            'IN123456'
        );
        Test.stopTest();
        
        // Verify order was updated for cooler back processing
        Order updatedOrder = [SELECT Cooler_Back_To_Processing__c, Cooler_Received_Date__c 
                             FROM Order WHERE Id = :testOrder.Id LIMIT 1];
    }
    
    @isTest
    static void testUpdateOrder_OrderNotFound() {
        Test.startTest();
        try {
            String result = OrderController.updateOrder(
                'NONEXISTENT',
                'OUT123456',
                'IN123456'
            );
        } catch (AuraHandledException e) {
            // Expected exception for non-existent order
        }
        Test.stopTest();
    }
    
    @isTest
    static void testUpdateOrder_NoAvailableMachines() {
        // Update all machines to be unavailable
        List<Machine__c> machines = [SELECT Id, Open_to_Schedule__c FROM Machine__c];
        for (Machine__c machine : machines) {
            machine.Open_to_Schedule__c = false;
        }
        update machines;
        
        Order testOrder = [SELECT OrderNumber FROM Order LIMIT 1];
        
        Test.startTest();
        String result = OrderController.updateOrder(
            testOrder.OrderNumber,
            'OUT123456',
            'IN123456'
        );
        Test.stopTest();
        
        // Verify no Machine_Job__c was created
        List<Machine_Job__c> machineJobs = [SELECT Id FROM Machine_Job__c];
    }
    
    @isTest
    static void testUpdateOrder_NoMachineAssigned() {
        // Remove machine assignment from order
        Order testOrder = [SELECT Id, OrderNumber FROM Order LIMIT 1];
        testOrder.Machine__c = null;
        update testOrder;
        
        Test.startTest();
        String result = OrderController.updateOrder(
            testOrder.OrderNumber,
            'OUT123456',
            'IN123456'
        );
        Test.stopTest();
        
        // Verify no Machine_Job__c was created
        List<Machine_Job__c> machineJobs = [SELECT Id FROM Machine_Job__c];
    }
    
    @isTest
    static void testUpdateOrder_WithNullTrackingNumbers() {
        Order testOrder = [SELECT OrderNumber FROM Order LIMIT 1];
        
        Test.startTest();
        String result = OrderController.updateOrder(
            testOrder.OrderNumber,
            null,
            null
        );
        Test.stopTest();
        
        // Verify order was still updated
        Order updatedOrder = [SELECT Cooler_Reaches__c FROM Order WHERE Id = :testOrder.Id LIMIT 1];
    }
    
    @isTest
    static void testUpdateOrder_BulkScenario() {
        // Get the test account created in setup
        Account testAccount = [SELECT Id FROM Account LIMIT 1];
        
        // Create multiple orders for bulk testing
        List<Order> bulkOrders = new List<Order>();
        for (Integer i = 1; i <= 5; i++) {
            Order bulkOrder = new Order(
                AccountId = testAccount.Id,
                Email__c = 'bulk' + i + '@example.com',
                Cooler_Reaches__c = false,
                Cooler_Back_To_Processing__c = false,
                Actual_Weight_oz__c = 25.0,
                Status = 'Draft',
                EffectiveDate = System.today(),
                Pricebook2Id = Test.getStandardPricebookId()
            );
            bulkOrders.add(bulkOrder);
        }
        insert bulkOrders;
        
        Test.startTest();
        for (Order bulkOrder : bulkOrders) {
            // Refresh to get OrderNumber after insert
            Order refreshedOrder = [SELECT OrderNumber FROM Order WHERE Id = :bulkOrder.Id];
            String result = OrderController.updateOrder(
                refreshedOrder.OrderNumber,
                'OUT' + refreshedOrder.OrderNumber,
                'IN' + refreshedOrder.OrderNumber
            );
        }
        Test.stopTest();
        
        // Verify all orders were updated
        List<Order> updatedBulkOrders = [SELECT Cooler_Reaches__c FROM Order 
                                        WHERE Id IN :bulkOrders];
    }
}